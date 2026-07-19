import logging
import re
from collections.abc import Sequence
from typing import Literal, Protocol, cast

from fastapi import APIRouter, HTTPException, status

from mapping_memory.ai import (
    ANSWER_FALLBACK,
    AnswerResponseError,
    GroundedAnswer,
    generate_grounded_answer,
)
from mapping_memory.category_scope import CategoryScope, CategoryScopeError, make_category_scope
from mapping_memory.chat import append_chat_turn, get_chat_thread, learning_enabled
from mapping_memory.memory import LOCAL_OWNER_ID, MemoryAdapter
from mapping_memory.notes import get_category
from mapping_memory.rag import RagContextChunk, RagSource, prepare_retrieval_context
from mapping_memory.schemas import (
    AskEvidenceSummary,
    AskRequest,
    AskResponse,
    AskSource,
    AskSourceSnippet,
)
from mapping_memory.settings import Settings

logger = logging.getLogger(__name__)


class MemoryProfile(Protocol):
    content: str


class MemoryClient(Protocol):
    def search(self, query: str) -> Sequence[MemoryProfile]: ...

    def learn(self, user_message: str, assistant_message: str) -> int: ...


def create_ask_router(
    settings: Settings, *, memory_adapter: MemoryClient | None = None
) -> APIRouter:
    router = APIRouter()
    adapter = memory_adapter or MemoryAdapter(settings)

    @router.post("/ask", response_model=AskResponse, response_model_exclude_none=True)
    def ask(request: AskRequest) -> AskResponse:
        if (
            request.thread_id is not None
            and get_chat_thread(settings.sqlite_path, LOCAL_OWNER_ID, request.thread_id) is None
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat thread not found",
            )

        category_scope = _validated_category_scope(request, settings=settings)
        memory_context: list[str] = []
        if _memory_configured(settings):
            try:
                memory_context = [record.content for record in adapter.search(request.question)]
            except Exception:
                logger.warning("Memory search unavailable; continuing without personalization")
        try:
            retrieval_context = prepare_retrieval_context(
                request.question,
                settings=settings,
                category_scope=category_scope,
                note_ids=request.note_ids,
                history=request.history,
            )
        except Exception:
            logger.warning("Ask retrieval unavailable")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Ask endpoint is unavailable",
            ) from None

        if not retrieval_context.sources:
            return _complete_turn(
                _no_evidence_response(),
                request.question,
                thread_id=request.thread_id,
                settings=settings,
                adapter=adapter,
            )

        try:
            answer = generate_grounded_answer(
                question=request.question,
                context=retrieval_context.formatted_context,
                history=request.history,
                memory_context=memory_context,
                settings=settings,
            )
        except AnswerResponseError:
            return _complete_turn(
                _no_evidence_response(),
                request.question,
                thread_id=request.thread_id,
                settings=settings,
                adapter=adapter,
            )
        except Exception:
            logger.warning("Ask answer generation unavailable")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Ask endpoint is unavailable",
            ) from None

        rendered_response = _render_grounded_answer(answer, retrieval_context.sources)
        if rendered_response is None:
            rendered_response = _no_evidence_response()

        return _complete_turn(
            rendered_response,
            request.question,
            thread_id=request.thread_id,
            settings=settings,
            adapter=adapter,
        )

    return router


def _complete_turn(
    response: AskResponse,
    question: str,
    *,
    thread_id: int | None,
    settings: Settings,
    adapter: MemoryClient,
) -> AskResponse:
    try:
        append_chat_turn(
            settings.sqlite_path,
            LOCAL_OWNER_ID,
            question,
            response,
            thread_id=thread_id,
        )
    except Exception:
        logger.warning("Chat transcript persistence unavailable")

    updates = 0
    try:
        if _memory_configured(settings) and learning_enabled(settings.sqlite_path, LOCAL_OWNER_ID):
            updates = adapter.learn(question, response.answer)
    except Exception:
        logger.warning("Memory learning unavailable; continuing without an update")
    return response.model_copy(update={"memory_updates": updates})


def _memory_configured(settings: Settings) -> bool:
    return (
        settings.memory_enabled
        and settings.groq_api_key is not None
        and settings.voyage_api_key is not None
    )


def _ask_sources(sources: tuple[RagSource, ...]) -> list[AskSource]:
    return [
        AskSource(
            note_id=source.note_id,
            title=source.title,
            date_added=source.date_added,
            snippets=_source_snippets(source),
        )
        for source in sources
    ]


def _render_grounded_answer(
    answer: object,
    sources: tuple[RagSource, ...],
) -> AskResponse | None:
    if not isinstance(answer, GroundedAnswer):
        return None
    if answer.status == "no_evidence":
        return _no_evidence_response() if not answer.claims else None
    if not answer.claims:
        return None

    evidence_by_id: dict[str, tuple[RagSource, RagContextChunk]] = {}
    for source in sources:
        for chunk in source.chunks:
            if not chunk.chunk_id or chunk.chunk_id in evidence_by_id:
                return None
            evidence_by_id[chunk.chunk_id] = (source, chunk)

    source_numbers: dict[int, int] = {}
    cited_chunks: dict[int, list[RagContextChunk]] = {}
    cited_sources: list[RagSource] = []
    rendered_claims: list[str] = []
    for claim in answer.claims:
        claim_text = claim.text.strip()
        if not claim_text or not claim.evidence_ids or re.search(r"\[\d+\]", claim_text):
            return None
        if len(set(claim.evidence_ids)) != len(claim.evidence_ids):
            return None

        claim_numbers: list[int] = []
        for evidence_id in claim.evidence_ids:
            if not evidence_id.strip() or evidence_id not in evidence_by_id:
                return None
            source, chunk = evidence_by_id[evidence_id]
            source_number = source_numbers.get(source.note_id)
            if source_number is None:
                source_number = len(source_numbers) + 1
                source_numbers[source.note_id] = source_number
                cited_sources.append(source)
                cited_chunks[source.note_id] = []
            if chunk not in cited_chunks[source.note_id]:
                cited_chunks[source.note_id].append(chunk)
            if source_number not in claim_numbers:
                claim_numbers.append(source_number)

        citations = " ".join(f"[{number}]" for number in claim_numbers)
        rendered_claims.append(f"{claim_text} {citations}")

    cited_rag_sources = tuple(
        RagSource(
            note_id=source.note_id,
            title=source.title,
            date_added=source.date_added,
            tags=source.tags,
            chunks=tuple(cited_chunks[source.note_id]),
        )
        for source in cited_sources
    )
    rendered_sources = _ask_sources(cited_rag_sources)
    return AskResponse(
        answer="\n\n".join(rendered_claims),
        status="answered",
        evidence_summary=_evidence_summary(rendered_sources),
        sources=rendered_sources,
    )


def _source_snippets(source: RagSource) -> list[AskSourceSnippet]:
    snippets: list[AskSourceSnippet] = []
    seen_texts: set[str] = set()
    for chunk in source.chunks:
        text = _snippet_text(chunk.text)
        if not text or text in seen_texts:
            continue

        snippets.append(
            AskSourceSnippet(
                text=text,
                match_type=chunk.match_type,
                chunk_index=chunk.chunk_index,
                chunk_type=chunk.chunk_type,
                source_start=chunk.source_start,
                source_end=chunk.source_end,
            )
        )
        seen_texts.add(text)

    return snippets


def _no_evidence_response() -> AskResponse:
    return AskResponse(
        answer=ANSWER_FALLBACK,
        status="no_evidence",
        evidence_summary=AskEvidenceSummary(
            source_count=0,
            snippet_count=0,
            match_types=[],
        ),
        sources=[],
    )


def _evidence_summary(sources: list[AskSource]) -> AskEvidenceSummary:
    match_types = cast(
        list[Literal["semantic", "exact", "fuzzy", "selected"]],
        sorted({snippet.match_type for source in sources for snippet in source.snippets}),
    )
    return AskEvidenceSummary(
        source_count=len(sources),
        snippet_count=sum(len(source.snippets) for source in sources),
        match_types=match_types,
    )


def _snippet_text(text: str, *, max_chars: int = 360) -> str:
    marker = "Chunk:"
    marker_index = text.find(marker)
    snippet = text[marker_index + len(marker) :] if marker_index >= 0 else text
    snippet = " ".join(snippet.split())
    if len(snippet) <= max_chars:
        return snippet

    return f"{snippet[: max_chars - len('...')].rstrip()}..."


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
