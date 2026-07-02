import logging

from fastapi import APIRouter, HTTPException, status

from mapping_memory.ai import ANSWER_FALLBACK, generate_grounded_answer
from mapping_memory.category_scope import CategoryScope, CategoryScopeError, make_category_scope
from mapping_memory.notes import get_category
from mapping_memory.rag import RagSource, prepare_retrieval_context
from mapping_memory.schemas import AskRequest, AskResponse, AskSource
from mapping_memory.settings import Settings

logger = logging.getLogger(__name__)


def create_ask_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.post("/ask", response_model=AskResponse)
    def ask(request: AskRequest) -> AskResponse:
        category_scope = _validated_category_scope(request, settings=settings)
        try:
            retrieval_context = prepare_retrieval_context(
                request.question,
                settings=settings,
                category_scope=category_scope,
                note_ids=request.note_ids,
            )
        except Exception:
            logger.warning("Ask retrieval unavailable")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Ask endpoint is unavailable",
            ) from None

        if not retrieval_context.sources:
            return AskResponse(answer=ANSWER_FALLBACK, sources=[])

        try:
            answer = generate_grounded_answer(
                question=request.question,
                context=retrieval_context.formatted_context,
                settings=settings,
            )
        except Exception:
            logger.warning("Ask answer generation unavailable")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Ask endpoint is unavailable",
            ) from None

        if answer == ANSWER_FALLBACK:
            return AskResponse(answer=ANSWER_FALLBACK, sources=[])

        return AskResponse(answer=answer, sources=_ask_sources(retrieval_context.sources))

    return router


def _ask_sources(sources: tuple[RagSource, ...]) -> list[AskSource]:
    return [
        AskSource(note_id=source.note_id, title=source.title, date_added=source.date_added)
        for source in sources
    ]


def _validated_category_scope(request: AskRequest, *, settings: Settings) -> CategoryScope:
    try:
        category_scope = make_category_scope(
            category_id=request.category_id, uncategorized=request.uncategorized
        )
    except CategoryScopeError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error

    if (
        category_scope.category_id is not None
        and get_category(settings.sqlite_path, category_scope.category_id) is None
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Category not found",
        )

    return category_scope
