import logging
from collections.abc import Iterable

from fastapi import APIRouter, HTTPException, Query, status

from mapping_memory.embeddings import embed_texts
from mapping_memory.notes import get_note, search_notes_exact
from mapping_memory.schemas import NoteRead, SearchResult
from mapping_memory.settings import Settings
from mapping_memory.vector_store import ChromaVectorStore, VectorSearchResult

SEARCH_LIMIT = 20
OVERLAP_BONUS = 1.0

logger = logging.getLogger(__name__)


def create_search_router(settings: Settings) -> APIRouter:
    router = APIRouter()

    @router.get("/search", response_model=list[SearchResult])
    def search(q: str | None = Query(default=None)) -> list[SearchResult]:
        query = (q or "").strip()
        if not query:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="q must not be empty",
            )

        exact_notes = search_notes_exact(settings.sqlite_path, query, limit=SEARCH_LIMIT)
        try:
            semantic_hits = _search_semantic_notes(query, settings=settings)
        except Exception:
            logger.warning("Semantic search unavailable; returning exact search results")
            semantic_hits = []

        return _merge_search_results(exact_notes, semantic_hits, limit=SEARCH_LIMIT)

    return router


def _search_semantic_notes(query: str, *, settings: Settings) -> list[NoteRead]:
    embedding = embed_texts([query], settings=settings)[0]
    hits = ChromaVectorStore(settings=settings).query_by_embedding(embedding, limit=SEARCH_LIMIT)
    note_ids = _ranked_note_ids(hits)

    notes: list[NoteRead] = []
    for note_id in note_ids:
        note = get_note(settings.sqlite_path, note_id)
        if note is not None:
            notes.append(note)

    return notes


def _merge_search_results(
    exact_notes: list[NoteRead],
    semantic_notes: list[NoteRead],
    *,
    limit: int,
) -> list[SearchResult]:
    notes_by_id = {note.id: note for note in exact_notes}
    notes_by_id.update({note.id: note for note in semantic_notes})
    exact_ranks = {note.id: rank for rank, note in enumerate(exact_notes, start=1)}
    semantic_ranks = {note.id: rank for rank, note in enumerate(semantic_notes, start=1)}

    results = [
        _to_search_result(
            note,
            exact_rank=exact_ranks.get(note.id),
            semantic_rank=semantic_ranks.get(note.id),
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
    )


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


def _metadata_note_id(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdecimal():
        return int(value)

    return None
