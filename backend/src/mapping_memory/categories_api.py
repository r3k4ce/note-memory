import logging

from fastapi import APIRouter, HTTPException, status

from mapping_memory import retrieval_index
from mapping_memory.notes import (
    CategoryAlreadyExistsError,
    create_category,
    delete_category,
    get_note,
    list_categories,
    list_notes,
    update_category,
)
from mapping_memory.schemas import (
    CategoryCreate,
    CategoryDeleteResponse,
    CategoryRead,
    CategoryUpdate,
)
from mapping_memory.settings import Settings

logger = logging.getLogger(__name__)


def create_categories_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.get("/categories", response_model=list[CategoryRead])
    def list_categories_endpoint() -> list[CategoryRead]:
        return list_categories(settings.sqlite_path)

    @router.post("/categories", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
    def create_category_endpoint(category: CategoryCreate) -> CategoryRead:
        try:
            return create_category(settings.sqlite_path, category.name)
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

    @router.patch("/categories/{category_id}", response_model=CategoryRead)
    def update_category_endpoint(category_id: int, category: CategoryUpdate) -> CategoryRead:
        try:
            updated_category = update_category(
                settings.sqlite_path,
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

        try:
            for note in list_notes(settings.sqlite_path, category_id=updated_category.id):
                retrieval_index.reindex_note_for_retrieval(note, settings=settings)
        except Exception:
            logger.warning("Retrieval reindexing unavailable after category rename")

        return updated_category

    @router.delete("/categories/{category_id}", response_model=CategoryDeleteResponse)
    def delete_category_endpoint(category_id: int) -> CategoryDeleteResponse:
        uncategorized_note_ids = delete_category(
            settings.sqlite_path,
            category_id,
            vault_path=settings.vault_path,
        )
        if uncategorized_note_ids is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")

        vector_cleanup = "deleted"
        for note_id in uncategorized_note_ids:
            try:
                note = get_note(settings.sqlite_path, note_id)
                if note is not None:
                    retrieval_index.reindex_note_for_retrieval(note, settings=settings)
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

    return router
