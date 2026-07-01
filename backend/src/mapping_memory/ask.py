import logging

from fastapi import APIRouter, HTTPException, status

from mapping_memory.ai import ANSWER_FALLBACK, generate_grounded_answer
from mapping_memory.rag import RagSource, prepare_retrieval_context
from mapping_memory.schemas import AskRequest, AskResponse, AskSource
from mapping_memory.settings import Settings

logger = logging.getLogger(__name__)


def create_ask_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.post("/ask", response_model=AskResponse)
    def ask(request: AskRequest) -> AskResponse:
        try:
            retrieval_context = prepare_retrieval_context(request.question, settings=settings)
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
