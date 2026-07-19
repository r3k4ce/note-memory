import logging
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from rapidfuzz import fuzz, process

from mapping_memory import retrieval_index
from mapping_memory.category_scope import CategoryScope, CategoryScopeError, make_category_scope
from mapping_memory.embeddings import embed_query
from mapping_memory.exact_search import ExactSearchMatch, search_notes_exact_matches
from mapping_memory.fts import SNIPPET_MAX_CHARS, collapse_whitespace, tags_to_text
from mapping_memory.notes import get_category, get_note, list_notes
from mapping_memory.provider_fingerprint import chroma_index_ready
from mapping_memory.schemas import NoteRead, SearchResult
from mapping_memory.settings import Settings
from mapping_memory.vector_store import ChromaVectorStore, VectorSearchResult

SEARCH_LIMIT = 20
OVERLAP_BONUS = 1.0
FUZZY_SCORE_CUTOFF = 85.0

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SemanticSearchMatch:
    note: NoteRead
    matched_snippet: str | None


@dataclass(frozen=True)
class FuzzySearchMatch:
    note: NoteRead
    matched_snippet: str | None
    score: float


def create_search_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.get("/search", response_model=list[SearchResult])
    def search(
        q: str | None = Query(default=None),
        category_id: int | None = Query(default=None),
        uncategorized: bool = Query(default=False),
        semantic: bool = Query(default=True),
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
        fuzzy_matches = _search_fuzzy_notes(
            query, settings=settings, category_scope=category_scope, exact_matches=exact_matches
        )
        semantic_hits: list[SemanticSearchMatch] = []
        if semantic and chroma_index_ready(settings):
            try:
                semantic_hits = _search_semantic_notes(
                    query, settings=settings, category_scope=category_scope
                )
            except Exception:
                logger.warning("Semantic search unavailable; returning local search results")

        return _merge_search_results(
            exact_matches, fuzzy_matches, semantic_hits, limit=SEARCH_LIMIT
        )

    return router


def _search_semantic_notes(
    query: str,
    *,
    settings: Settings,
    category_scope: CategoryScope,
) -> list[SemanticSearchMatch]:
    embedding = embed_query(query, settings=settings)
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
    fuzzy_matches: list[FuzzySearchMatch],
    semantic_matches: list[SemanticSearchMatch],
    *,
    limit: int,
) -> list[SearchResult]:
    exact_notes = [match.note for match in exact_matches]
    fuzzy_notes = [match.note for match in fuzzy_matches]
    semantic_notes = [match.note for match in semantic_matches]
    notes_by_id = {note.id: note for note in exact_notes}
    notes_by_id.update({note.id: note for note in fuzzy_notes})
    notes_by_id.update({note.id: note for note in semantic_notes})
    exact_ranks = {note.id: rank for rank, note in enumerate(exact_notes, start=1)}
    exact_snippets = {match.note.id: match.matched_snippet for match in exact_matches}
    fuzzy_ranks = {note.id: rank for rank, note in enumerate(fuzzy_notes, start=1)}
    fuzzy_scores = {match.note.id: match.score for match in fuzzy_matches}
    fuzzy_snippets = {match.note.id: match.matched_snippet for match in fuzzy_matches}
    semantic_snippets = {match.note.id: match.matched_snippet for match in semantic_matches}
    semantic_ranks = {note.id: rank for rank, note in enumerate(semantic_notes, start=1)}

    results = [
        _to_search_result(
            note,
            exact_rank=exact_ranks.get(note.id),
            fuzzy_rank=fuzzy_ranks.get(note.id),
            fuzzy_score=fuzzy_scores.get(note.id),
            semantic_rank=semantic_ranks.get(note.id),
            matched_snippet=(
                exact_snippets.get(note.id)
                or fuzzy_snippets.get(note.id)
                or semantic_snippets.get(note.id)
            ),
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
    fuzzy_rank: int | None,
    fuzzy_score: float | None,
    semantic_rank: int | None,
    matched_snippet: str | None,
) -> SearchResult:
    score = (
        _rank_score(exact_rank)
        + _fuzzy_rank_score(fuzzy_rank, fuzzy_score)
        + _rank_score(semantic_rank)
    )
    if semantic_rank is not None and (exact_rank is not None or fuzzy_rank is not None):
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
        match_type=_match_type(
            exact_rank=exact_rank, fuzzy_rank=fuzzy_rank, semantic_rank=semantic_rank
        ),
    )


def _match_type(
    *,
    exact_rank: int | None,
    fuzzy_rank: int | None,
    semantic_rank: int | None,
) -> Literal["exact", "semantic", "hybrid", "fuzzy"]:
    if semantic_rank is not None and (exact_rank is not None or fuzzy_rank is not None):
        return "hybrid"
    if exact_rank is not None:
        return "exact"
    if fuzzy_rank is not None:
        return "fuzzy"
    if semantic_rank is not None:
        return "semantic"

    raise ValueError("search result must have an exact, fuzzy, or semantic rank")


def _rank_score(rank: int | None) -> float:
    if rank is None:
        return 0.0

    return 1 / rank


def _fuzzy_rank_score(rank: int | None, score: float | None) -> float:
    if rank is None or score is None:
        return 0.0

    return (score / 100) / (rank + 1)


def _search_fuzzy_notes(
    query: str,
    *,
    settings: Settings,
    category_scope: CategoryScope,
    exact_matches: list[ExactSearchMatch],
) -> list[FuzzySearchMatch]:
    exact_note_ids = {match.note.id for match in exact_matches}
    choices: dict[str, str] = {}
    notes_by_id = {
        note.id: note
        for note in list_notes(
            settings.sqlite_path,
            category_id=category_scope.category_id,
            uncategorized=category_scope.uncategorized,
        )
    }
    for note in notes_by_id.values():
        if note.id in exact_note_ids:
            continue

        choices[f"{note.id}:title"] = note.ai_title
        choices[f"{note.id}:tags"] = tags_to_text(note.tags)

    raw_matches = process.extract(
        query,
        choices,
        scorer=fuzz.partial_ratio,
        score_cutoff=FUZZY_SCORE_CUTOFF,
        limit=SEARCH_LIMIT * 4,
    )
    matches_by_note_id: dict[int, FuzzySearchMatch] = {}
    for snippet, score, key in raw_matches:
        note_id_text = str(key).split(":", maxsplit=1)[0]
        if not note_id_text.isdecimal():
            continue

        note_id = int(note_id_text)
        note = notes_by_id.get(note_id)
        if note is None:
            continue

        existing_match = matches_by_note_id.get(note_id)
        if existing_match is None or score > existing_match.score:
            matches_by_note_id[note_id] = FuzzySearchMatch(
                note=note,
                matched_snippet=_fuzzy_snippet(snippet),
                score=score,
            )

    return sorted(matches_by_note_id.values(), key=lambda match: match.score, reverse=True)[
        :SEARCH_LIMIT
    ]


def _fuzzy_snippet(text: str, *, max_chars: int = SNIPPET_MAX_CHARS) -> str | None:
    snippet = collapse_whitespace(text)
    if not snippet:
        return None
    if len(snippet) <= max_chars:
        return snippet

    return f"{snippet[: max_chars - len('...')].rstrip()}..."


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
    chunks = [chunk for note in notes for chunk in retrieval_index.retrieval_chunks_for_note(note)]
    vector_store.update_chunk_metadata(chunks)
