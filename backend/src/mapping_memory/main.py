import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from mapping_memory.ai import organize_mapping_text
from mapping_memory.chunking import create_retrieval_chunks
from mapping_memory.db import init_db
from mapping_memory.embeddings import embed_texts
from mapping_memory.notes import create_note, get_note, list_notes
from mapping_memory.schemas import NoteCreate, NoteRead
from mapping_memory.settings import Settings
from mapping_memory.vector_store import ChromaVectorStore

LOCAL_FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        init_db(app_settings.sqlite_path)
        yield

    app = FastAPI(title=app_settings.app_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=LOCAL_FRONTEND_ORIGINS,
        allow_methods=["GET", "POST"],
        allow_headers=["content-type"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/notes", response_model=NoteRead, status_code=status.HTTP_201_CREATED)
    def create_note_endpoint(note: NoteCreate) -> NoteRead:
        try:
            metadata = organize_mapping_text(note.original_text, settings=app_settings)
        except Exception:
            logger.warning("AI organizer unavailable; saved note with fallback metadata")
            created_note = create_note(app_settings.sqlite_path, note.original_text)
        else:
            created_note = create_note(
                app_settings.sqlite_path,
                note.original_text,
                ai_title=metadata.title,
                short_summary=metadata.summary,
                tags=metadata.tags,
            )

        try:
            _index_note_for_retrieval(created_note, settings=app_settings)
        except Exception:
            logger.warning("Retrieval indexing unavailable; saved note without vector index")

        return created_note

    @app.get("/notes", response_model=list[NoteRead])
    def list_notes_endpoint() -> list[NoteRead]:
        return list_notes(app_settings.sqlite_path)

    @app.get("/notes/{note_id}", response_model=NoteRead)
    def get_note_endpoint(note_id: int) -> NoteRead:
        note = get_note(app_settings.sqlite_path, note_id)
        if note is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

        return note

    return app


def _index_note_for_retrieval(note: NoteRead, *, settings: Settings) -> None:
    chunks = create_retrieval_chunks(
        note_id=note.id,
        original_text=note.original_text,
        ai_title=note.ai_title,
        short_summary=note.short_summary,
        tags=note.tags,
        date_added=note.date_added,
    )
    embeddings = embed_texts([chunk.text for chunk in chunks], settings=settings)
    ChromaVectorStore(settings=settings).add_chunks(chunks, embeddings=embeddings)


app = create_app()
