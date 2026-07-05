import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware

from mapping_memory.ai import organize_mapping_text
from mapping_memory.ask import create_ask_router
from mapping_memory.chunking import create_retrieval_chunks
from mapping_memory.db import init_db
from mapping_memory.embeddings import embed_texts
from mapping_memory.notes import (
    CategoryAlreadyExistsError,
    CategoryNotFoundError,
    create_category,
    create_note,
    delete_category,
    delete_note,
    get_category,
    get_note,
    list_categories,
    list_notes,
    sync_markdown_vault,
    update_category,
    update_note,
)
from mapping_memory.schemas import (
    CategoryCreate,
    CategoryDeleteResponse,
    CategoryRead,
    CategoryUpdate,
    NoteCreate,
    NoteDeleteResponse,
    NoteOrganizeRequest,
    NoteOrganizeResponse,
    NoteRead,
    NoteUpdate,
)
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
        sync_markdown_vault(app_settings.sqlite_path, app_settings.vault_path)
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

    @app.get("/categories", response_model=list[CategoryRead])
    def list_categories_endpoint() -> list[CategoryRead]:
        return list_categories(app_settings.sqlite_path)

    @app.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
    def create_category_endpoint(category: CategoryCreate) -> CategoryRead:
        try:
            return create_category(app_settings.sqlite_path, category.name)
        except CategoryAlreadyExistsError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(error),
            ) from error
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
            ) from error

    @app.patch("/categories/{category_id}", response_model=CategoryRead)
    def update_category_endpoint(category_id: int, category: CategoryUpdate) -> CategoryRead:
        try:
            updated_category = update_category(
                app_settings.sqlite_path,
                category_id,
                category.name,
            )
        except CategoryAlreadyExistsError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(error),
            ) from error
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
            ) from error
        if updated_category is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

        return updated_category

    @app.delete("/categories/{category_id}", response_model=CategoryDeleteResponse)
    def delete_category_endpoint(category_id: int) -> CategoryDeleteResponse:
        uncategorized_note_ids = delete_category(
            app_settings.sqlite_path,
            category_id,
            vault_path=app_settings.vault_path,
        )
        if uncategorized_note_ids is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

        vector_cleanup = "deleted"
        for note_id in uncategorized_note_ids:
            try:
                note = get_note(app_settings.sqlite_path, note_id)
                if note is not None:
                    _reindex_note_for_retrieval(note, settings=app_settings)
            except Exception:
                logger.warning(
                    "Retrieval cleanup unavailable; "
                    "uncategorized category notes without full vector cleanup"
                )
                vector_cleanup = "failed"

        return CategoryDeleteResponse(
            id=category_id,
            deleted=True,
            deleted_note_ids=[],
            uncategorized_note_ids=uncategorized_note_ids,
            vector_cleanup=vector_cleanup,
        )

    @app.post("/notes", response_model=NoteRead, status_code=status.HTTP_201_CREATED)
    def create_note_endpoint(note: NoteCreate) -> NoteRead:
        _validate_category_id(note.category_id, settings=app_settings)
        provided_metadata = (
            note.ai_title is not None or note.short_summary is not None or note.tags is not None
        )
        if provided_metadata:
            try:
                created_note = create_note(
                    app_settings.sqlite_path,
                    note.original_text,
                    ai_title=note.ai_title,
                    short_summary=note.short_summary,
                    tags=note.tags,
                    category_id=note.category_id,
                    vault_path=app_settings.vault_path,
                )
            except CategoryNotFoundError as error:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=str(error),
                ) from error
        else:
            try:
                metadata = organize_mapping_text(note.original_text, settings=app_settings)
            except Exception:
                logger.warning("AI organizer unavailable; saved note with fallback metadata")
                try:
                    created_note = create_note(
                        app_settings.sqlite_path,
                        note.original_text,
                        category_id=note.category_id,
                        vault_path=app_settings.vault_path,
                    )
                except CategoryNotFoundError as error:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=str(error),
                    ) from error
            else:
                try:
                    created_note = create_note(
                        app_settings.sqlite_path,
                        note.original_text,
                        ai_title=metadata.title,
                        short_summary=metadata.summary,
                        tags=metadata.tags,
                        category_id=note.category_id,
                        vault_path=app_settings.vault_path,
                    )
                except CategoryNotFoundError as error:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=str(error),
                    ) from error

        try:
            _index_note_for_retrieval(created_note, settings=app_settings)
        except Exception:
            logger.warning("Retrieval indexing unavailable; saved note without vector index")

        return created_note

    @app.get("/notes", response_model=list[NoteRead])
    def list_notes_endpoint(category_id: int | None = Query(default=None)) -> list[NoteRead]:
        try:
            return list_notes(app_settings.sqlite_path, category_id=category_id)
        except CategoryNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
            ) from error

    @app.post("/notes/organize", response_model=NoteOrganizeResponse)
    def organize_note_endpoint(note: NoteOrganizeRequest) -> NoteOrganizeResponse:
        try:
            metadata = organize_mapping_text(note.original_text, settings=app_settings)
        except Exception as error:
            logger.warning("AI organizer unavailable for note draft")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="AI organizer unavailable",
            ) from error

        return NoteOrganizeResponse(
            ai_title=metadata.title,
            short_summary=metadata.summary,
            tags=metadata.tags,
        )

    @app.patch("/notes/{note_id}", response_model=NoteRead)
    def update_note_endpoint(note_id: int, note_update: NoteUpdate) -> NoteRead:
        updates = note_update.model_dump(exclude_unset=True)
        update_kwargs = {
            "original_text": updates.get("original_text"),
            "ai_title": updates.get("ai_title"),
            "short_summary": updates.get("short_summary"),
            "tags": updates.get("tags"),
        }
        if "category_id" in updates:
            update_kwargs["category_id"] = updates["category_id"]

        try:
            updated_note = update_note(
                app_settings.sqlite_path,
                note_id,
                vault_path=app_settings.vault_path,
                **update_kwargs,
            )
        except CategoryNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
            ) from error
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
        if not delete_note(app_settings.sqlite_path, note_id, vault_path=app_settings.vault_path):
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


def _validate_category_id(category_id: int | None, *, settings: Settings) -> None:
    if category_id is not None and get_category(settings.sqlite_path, category_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Category not found",
        )


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
        category_id=note.category.id if note.category is not None else None,
        category_name=note.category.name if note.category is not None else None,
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
        category_id=note.category.id if note.category is not None else None,
        category_name=note.category.name if note.category is not None else None,
    )
    embeddings = embed_texts([chunk.text for chunk in chunks], settings=settings)
    ChromaVectorStore(settings=settings).add_chunks(chunks, embeddings=embeddings)


app = create_app()
