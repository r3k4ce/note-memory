from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware

from mapping_memory.db import init_db
from mapping_memory.notes import create_note, get_note, list_notes
from mapping_memory.schemas import NoteCreate, NoteRead
from mapping_memory.settings import Settings

LOCAL_FRONTEND_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]


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
        return create_note(app_settings.sqlite_path, note.original_text)

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


app = create_app()
