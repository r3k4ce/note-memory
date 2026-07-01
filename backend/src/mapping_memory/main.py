import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from mapping_memory.ai import organize_mapping_text
from mapping_memory.ask import create_ask_router
from mapping_memory.chunking import create_retrieval_chunks
from mapping_memory.db import init_db
from mapping_memory.embeddings import embed_texts
from mapping_memory.notes import (
    create_note,
    delete_note,
    get_note,
    list_notes,
    update_note_metadata,
)
from mapping_memory.schemas import NoteCreate, NoteDeleteResponse, NoteRead, NoteUpdate
from mapping_memory.search import create_search_router
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
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["content-type"],
    )
    app.include_router(create_search_router(app_settings))
    app.include_router(create_ask_router(app_settings))

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

    @app.patch("/notes/{note_id}", response_model=NoteRead)
    def update_note_endpoint(note_id: int, note_update: NoteUpdate) -> NoteRead:
        updates = note_update.model_dump(exclude_unset=True)
        updated_note = update_note_metadata(
            app_settings.sqlite_path,
            note_id,
            ai_title=updates.get("ai_title"),
            short_summary=updates.get("short_summary"),
            tags=updates.get("tags"),
        )
        if updated_note is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

        try:
            _reindex_note_for_retrieval(updated_note, settings=app_settings)
        except Exception:
            logger.warning(
                "Retrieval reindexing unavailable; saved note metadata without vector index"
            )

        return updated_note

    @app.delete("/notes/{note_id}", response_model=NoteDeleteResponse)
    def delete_note_endpoint(note_id: int) -> NoteDeleteResponse:
        if not delete_note(app_settings.sqlite_path, note_id):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

        vector_cleanup = "deleted"
        try:
            _delete_note_from_retrieval(note_id, settings=app_settings)
        except Exception:
            logger.warning("Retrieval cleanup unavailable; deleted note without vector cleanup")
            vector_cleanup = "failed"

        return NoteDeleteResponse(id=note_id, deleted=True, vector_cleanup=vector_cleanup)

    @app.get("/notes/{note_id}", response_model=NoteRead)
    def get_note_endpoint(note_id: int) -> NoteRead:
        note = get_note(app_settings.sqlite_path, note_id)
        if note is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

        return note

    return app


def _delete_note_from_retrieval(note_id: int, *, settings: Settings) -> None:
    ChromaVectorStore(settings=settings).delete_chunks_for_note(note_id)


def _reindex_note_for_retrieval(note: NoteRead, *, settings: Settings) -> None:
    vector_store = ChromaVectorStore(settings=settings)
    vector_store.delete_chunks_for_note(note.id)
    chunks = create_retrieval_chunks(
        note_id=note.id,
        original_text=note.original_text,
        ai_title=note.ai_title,
        short_summary=note.short_summary,
        tags=note.tags,
        date_added=note.date_added,
    )
    embeddings = embed_texts([chunk.text for chunk in chunks], settings=settings)
    vector_store.add_chunks(chunks, embeddings=embeddings)


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
