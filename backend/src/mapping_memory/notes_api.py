import logging

from fastapi import APIRouter, HTTPException, Query, status

from mapping_memory import retrieval_index
from mapping_memory.ai import organize_mapping_text
from mapping_memory.notes import (
    CategoryNotFoundError,
    create_note,
    delete_note,
    get_category,
    get_note,
    list_notes,
    update_note,
)
from mapping_memory.schemas import (
    NoteCreate,
    NoteDeleteResponse,
    NoteOrganizeRequest,
    NoteOrganizeResponse,
    NoteRead,
    NoteUpdate,
)
from mapping_memory.settings import Settings

logger = logging.getLogger(__name__)


def create_notes_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.post("/notes", response_model=NoteRead, status_code=status.HTTP_201_CREATED)
    def create_note_endpoint(note: NoteCreate) -> NoteRead:
        _validate_category_id(note.category_id, settings=settings)
        title = note.ai_title
        summary = note.short_summary
        tags = note.tags
        needs_ai_organization = False
        if title is None or summary is None or tags is None:
            try:
                metadata = organize_mapping_text(note.original_text, settings=settings)
            except Exception:
                logger.warning("AI organizer unavailable; saved note with fallback metadata")
                needs_ai_organization = True
            else:
                title = title if title is not None else metadata.title
                summary = summary if summary is not None else metadata.summary
                tags = tags if tags is not None else metadata.tags

        try:
            created_note = create_note(
                settings.sqlite_path,
                note.original_text,
                ai_title=title,
                short_summary=summary,
                tags=tags,
                category_id=note.category_id,
                vault_path=settings.vault_path,
                needs_ai_organization=needs_ai_organization,
            )
        except CategoryNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
            ) from error

        try:
            retrieval_index.index_note_for_retrieval(created_note, settings=settings)
        except Exception:
            logger.warning("Retrieval indexing unavailable; saved note without vector index")

        return created_note

    @router.get("/notes", response_model=list[NoteRead])
    def list_notes_endpoint(category_id: int | None = Query(default=None)) -> list[NoteRead]:
        try:
            return list_notes(settings.sqlite_path, category_id=category_id)
        except CategoryNotFoundError as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(error),
            ) from error

    @router.post("/notes/organize", response_model=NoteOrganizeResponse)
    def organize_note_endpoint(note: NoteOrganizeRequest) -> NoteOrganizeResponse:
        try:
            metadata = organize_mapping_text(note.original_text, settings=settings)
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

    @router.patch("/notes/{note_id}", response_model=NoteRead)
    def update_note_endpoint(note_id: int, note_update: NoteUpdate) -> NoteRead:
        updates = note_update.model_dump(exclude_unset=True)
        update_kwargs = {
            "original_text": updates.get("original_text"),
            "ai_title": updates.get("ai_title"),
            "short_summary": updates.get("short_summary"),
            "tags": updates.get("tags"),
            "ai_organization_completed": updates.get("ai_organization_completed", False),
        }
        if "category_id" in updates:
            update_kwargs["category_id"] = updates["category_id"]

        try:
            updated_note = update_note(
                settings.sqlite_path,
                note_id,
                vault_path=settings.vault_path,
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
            retrieval_index.reindex_note_for_retrieval(updated_note, settings=settings)
        except Exception:
            logger.warning(
                "Retrieval reindexing unavailable; saved note metadata without vector index"
            )

        return updated_note

    @router.delete("/notes/{note_id}", response_model=NoteDeleteResponse)
    def delete_note_endpoint(note_id: int) -> NoteDeleteResponse:
        if not delete_note(settings.sqlite_path, note_id, vault_path=settings.vault_path):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

        vector_cleanup = "deleted"
        try:
            retrieval_index.delete_note_from_retrieval(note_id, settings=settings)
        except Exception:
            logger.warning("Retrieval cleanup unavailable; deleted note without vector cleanup")
            vector_cleanup = "failed"

        return NoteDeleteResponse(id=note_id, deleted=True, vector_cleanup=vector_cleanup)

    @router.get("/notes/{note_id}", response_model=NoteRead)
    def get_note_endpoint(note_id: int) -> NoteRead:
        note = get_note(settings.sqlite_path, note_id)
        if note is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")

        return note

    return router


def _validate_category_id(category_id: int | None, *, settings: Settings) -> None:
    if category_id is not None and get_category(settings.sqlite_path, category_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Category not found",
        )
