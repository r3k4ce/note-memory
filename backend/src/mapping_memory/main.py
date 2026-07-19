from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from mapping_memory import retrieval_index
from mapping_memory.ask import create_ask_router
from mapping_memory.categories_api import create_categories_router
from mapping_memory.db import init_db
from mapping_memory.memory import MemoryAdapter
from mapping_memory.memory_api import create_memory_router
from mapping_memory.notes_api import create_notes_router
from mapping_memory.provider_fingerprint import chroma_index_ready
from mapping_memory.search import create_search_router
from mapping_memory.settings import Settings
from mapping_memory.vault_sync import sync_markdown_vault

LOCAL_FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings()
    memory_adapter = MemoryAdapter(app_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        init_db(app_settings.sqlite_path)
        sync_markdown_vault(app_settings.sqlite_path, app_settings.vault_path)
        retrieval_index.reconcile_chroma_with_sqlite(settings=app_settings)
        memory_adapter.initialize()
        yield

    app = FastAPI(title=app_settings.app_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=LOCAL_FRONTEND_ORIGINS,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["content-type"],
    )
    app.include_router(create_search_router(app_settings))
    app.include_router(create_ask_router(app_settings, memory_adapter=memory_adapter))
    app.include_router(create_memory_router(app_settings, memory_adapter))

    @app.get("/health")
    def health() -> dict[str, object]:
        groq_configured = app_settings.groq_api_key is not None
        voyage_configured = app_settings.voyage_api_key is not None
        return {
            "status": "ok",
            "capabilities": {
                "groq": groq_configured,
                "voyage": voyage_configured,
                "organization": groq_configured,
                "semantic_search": chroma_index_ready(app_settings),
                "ask": groq_configured,
                "reranking": voyage_configured,
                "memory": memory_adapter.available,
            },
        }

    app.include_router(create_categories_router(app_settings))
    app.include_router(create_notes_router(app_settings))

    return app


app = create_app()
