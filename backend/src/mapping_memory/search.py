import logging
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status

from mapping_memory.category_scope import CategoryScope, CategoryScopeError, make_category_scope
from mapping_memory.chunking import create_retrieval_chunks
from mapping_memory.embeddings import embed_texts
from mapping_memory.fts import SNIPPET_MAX_CHARS, collapse_whitespace
from mapping_memory.notes import (
    ExactSearchMatch,
    get_category,
    get_note,
    list_notes,
    search_notes_exact_matches,
)
from mapping_memory.schemas import NoteRead, SearchResult
from mapping_memory.settings import Settings
from mapping_memory.vector_store import ChromaVectorStore, VectorSearchResult

SEARCH_LIMIT = 20
OVERLAP_BONUS = 1.0

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SemanticSearchMatch:
    note: NoteRead
    matched_snippet: str | None


def create_search_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.get("/search", response_model=list[SearchResult])
    def search(
        q: str | None = Query(default=None),
        category_id: int | None = Query(default=None),
        uncategorized: bool = Query(default=False),
    ) -> list[SearchResult]:
        query = (q or "").strip()
        if not query:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="q must not be empty",
            )

        category_scope = _validated_category_scope(
            category_id=category_id, uncategorized=uncategorized, settings=settings
        )
        exact_matches = search_notes_exact_matches(
            settings.sqlite_path, query, limit=SEARCH_LIMIT, category_scope=category_scope
        )
        try:
            semantic_hits = _search_semantic_notes(
                query, settings=settings, category_scope=category_scope
            )
        except Exception:
            logger.warning("Semantic search unavailable; returning exact search results")
            semantic_hits = []

        return _merge_search_results(exact_matches, semantic_hits, limit=SEARCH_LIMIT)

    return router


def _search_semantic_notes(
    query: str,
    *,
    settings: Settings,
    category_scope: CategoryScope,
) -> list[SemanticSearchMatch]:
    embedding = embed_texts([query], settings=settings)[0]
    vector_store = ChromaVectorStore(settings=settings)
    _sync_scope_category_metadata(vector_store, settings=settings, category_scope=category_scope)
    hits = vector_store.query_by_embedding(
        embedding, limit=SEARCH_LIMIT, where=category_scope.chroma_where
    )
    note_ids = _ranked_note_ids(hits)
    snippets_by_note_id = _semantic_snippets_by_note_id(hits)

    matches: list[SemanticSearchMatch] = []
    for note_id in note_ids:
        note = get_note(settings.sqlite_path, note_id)
        if note is not None and _note_matches_scope(note, category_scope):
            matches.append(
                SemanticSearchMatch(
                    note=note,
                    matched_snippet=snippets_by_note_id.get(note_id),
                )
            )

    return matches


def _merge_search_results(
    exact_matches: list[ExactSearchMatch],
    semantic_matches: list[SemanticSearchMatch],
    *,
    limit: int,
) -> list[SearchResult]:
    exact_notes = [match.note for match in exact_matches]
    semantic_notes = [match.note for match in semantic_matches]
    notes_by_id = {note.id: note for note in exact_notes}
    notes_by_id.update({note.id: note for note in semantic_notes})
    exact_ranks = {note.id: rank for rank, note in enumerate(exact_notes, start=1)}
    exact_snippets = {match.note.id: match.matched_snippet for match in exact_matches}
    semantic_snippets = {match.note.id: match.matched_snippet for match in semantic_matches}
    semantic_ranks = {note.id: rank for rank, note in enumerate(semantic_notes, start=1)}

    results = [
        _to_search_result(
            note,
            exact_rank=exact_ranks.get(note.id),
            semantic_rank=semantic_ranks.get(note.id),
            matched_snippet=exact_snippets.get(note.id) or semantic_snippets.get(note.id),
        )
        for note in notes_by_id.values()
    ]
    return sorted(
        results, key=lambda result: (result.score, result.date_added, result.id), reverse=True
    )[:limit]


def _to_search_result(
    note: NoteRead,
    *,
    exact_rank: int | None,
    semantic_rank: int | None,
    matched_snippet: str | None,
) -> SearchResult:
    score = _rank_score(exact_rank) + _rank_score(semantic_rank)
    if exact_rank is not None and semantic_rank is not None:
        score += OVERLAP_BONUS

    return SearchResult(
        id=note.id,
        ai_title=note.ai_title,
        short_summary=note.short_summary,
        tags=note.tags,
        date_added=note.date_added,
        score=score,
        category=note.category,
        matched_snippet=matched_snippet,
        match_type=_match_type(exact_rank=exact_rank, semantic_rank=semantic_rank),
    )


def _match_type(
    *,
    exact_rank: int | None,
    semantic_rank: int | None,
) -> Literal["exact", "semantic", "hybrid"]:
    if exact_rank is not None and semantic_rank is not None:
        return "hybrid"
    if exact_rank is not None:
        return "exact"
    if semantic_rank is not None:
        return "semantic"

    raise ValueError("search result must have an exact or semantic rank")


def _rank_score(rank: int | None) -> float:
    if rank is None:
        return 0.0

    return 1 / rank


def _ranked_note_ids(hits: Iterable[VectorSearchResult]) -> list[int]:
    note_ids: list[int] = []
    seen: set[int] = set()
    for hit in hits:
        note_id = _metadata_note_id(hit.metadata.get("note_id"))
        if note_id is None or note_id in seen:
            continue
        seen.add(note_id)
        note_ids.append(note_id)

    return note_ids


def _semantic_snippets_by_note_id(hits: Iterable[VectorSearchResult]) -> dict[int, str]:
    snippets: dict[int, str] = {}
    for hit in hits:
        note_id = _metadata_note_id(hit.metadata.get("note_id"))
        if note_id is None or note_id in snippets:
            continue
        snippet = _semantic_snippet(hit.text)
        if snippet is not None:
            snippets[note_id] = snippet

    return snippets


def _semantic_snippet(text: str, *, max_chars: int = SNIPPET_MAX_CHARS) -> str | None:
    if max_chars <= 0:
        return None

    snippet_source = _chunk_body_text(text)
    snippet = collapse_whitespace(snippet_source)
    if not snippet:
        return None

    if len(snippet) <= max_chars:
        return snippet

    return f"{snippet[: max_chars - len('...')].rstrip()}..."


def _chunk_body_text(text: str) -> str:
    marker = "Chunk:"
    marker_index = text.find(marker)
    if marker_index < 0:
        return text

    return text[marker_index + len(marker) :]


def _metadata_note_id(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdecimal():
        return int(value)

    return None


def _validated_category_scope(
    *,
    category_id: int | None,
    uncategorized: bool,
    settings: Settings,
) -> CategoryScope:
    try:
        category_scope = make_category_scope(category_id=category_id, uncategorized=uncategorized)
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


def _note_matches_scope(note: NoteRead, category_scope: CategoryScope) -> bool:
    note_category_id = note.category.id if note.category is not None else None
    return category_scope.matches_category_id(note_category_id)


def _sync_scope_category_metadata(
    vector_store: ChromaVectorStore,
    *,
    settings: Settings,
    category_scope: CategoryScope,
) -> None:
    if category_scope.is_all:
        return

    notes = list_notes(
        settings.sqlite_path,
        category_id=category_scope.category_id,
        uncategorized=category_scope.uncategorized,
    )
    chunks = [chunk for note in notes for chunk in _chunks_for_note(note)]
    vector_store.update_chunk_metadata(chunks)


def _chunks_for_note(note: NoteRead):
    return create_retrieval_chunks(
        note_id=note.id,
        original_text=note.original_text,
        ai_title=note.ai_title,
        short_summary=note.short_summary,
        tags=note.tags,
        date_added=note.date_added,
        category_id=note.category.id if note.category is not None else None,
        category_name=note.category.name if note.category is not None else None,
    )
