import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Literal, cast

from mapping_memory import retrieval_index
from mapping_memory.category_scope import CategoryScope
from mapping_memory.chunking import ChunkType, RetrievalChunk
from mapping_memory.embeddings import embed_query
from mapping_memory.exact_search import ExactSearchMatch, search_notes_exact_matches
from mapping_memory.fts import tags_to_text
from mapping_memory.notes import get_note, list_notes
from mapping_memory.provider_fingerprint import chroma_index_ready
from mapping_memory.settings import Settings
from mapping_memory.vector_store import ChromaVectorStore, build_chunk_id
from mapping_memory.voyage_reranker import rerank_chunks

RAG_RETRIEVAL_LIMIT = 20
RAG_FALLBACK_RETRIEVAL_LIMIT = 100
RAG_MAX_CHUNKS_PER_NOTE = 2
RAG_FINAL_CHUNK_LIMIT = 8
RAG_SELECTED_NOTE_RESCUE_LIMIT = 5
RAG_LOCAL_MATCH_LIMIT = 8
RAG_FUZZY_SCORE_CUTOFF = 85.0

logger = logging.getLogger(__name__)

RagMatchType = Literal["semantic", "exact", "fuzzy", "selected"]


@dataclass(frozen=True)
class RagContextChunk:
    chunk_id: str
    chunk_index: int | None
    text: str
    distance: float | None
    match_type: RagMatchType = "semantic"
    chunk_type: ChunkType | None = None
    source_start: int | None = None
    source_end: int | None = None


@dataclass(frozen=True)
class RagSource:
    note_id: int
    title: str
    date_added: str
    tags: tuple[str, ...]
    chunks: tuple[RagContextChunk, ...]


@dataclass(frozen=True)
class RagRetrievalContext:
    sources: tuple[RagSource, ...]
    formatted_context: str


def prepare_retrieval_context(
    question: str,
    *,
    settings: Settings,
    category_scope: CategoryScope | None = None,
    note_ids: Sequence[int] | None = None,
) -> RagRetrievalContext:
    query = question.strip()
    if not query:
        raise ValueError("question must not be empty")
    if note_ids == []:
        return RagRetrievalContext(sources=(), formatted_context="")

    scope = category_scope or CategoryScope()
    selected_note_ids = set(note_ids) if note_ids is not None else None
    source_chunks: dict[int, list[RagContextChunk]] = {}
    sources_by_note_id: dict[int, RagSource] = {}
    accepted_count = 0

    accepted_count = _add_exact_matches_to_sources(
        query,
        settings=settings,
        scope=scope,
        selected_note_ids=selected_note_ids,
        source_chunks=source_chunks,
        sources_by_note_id=sources_by_note_id,
        accepted_count=accepted_count,
    )
    if accepted_count < RAG_FINAL_CHUNK_LIMIT and chroma_index_ready(settings):
        try:
            retrieval_query = build_retrieval_query(query)
            embedding = embed_query(retrieval_query, settings=settings)
            vector_store = ChromaVectorStore(settings=settings)
            _sync_scope_category_metadata(vector_store, settings=settings, category_scope=scope)
            where = _combined_chroma_where(category_scope=scope, note_ids=note_ids)
            hits = _query_hits(
                vector_store, embedding, where=where, fallback_where=scope.chroma_where
            )
            if selected_note_ids is not None:
                hits = [
                    hit
                    for hit in hits
                    if _metadata_int(hit.metadata.get("note_id")) in selected_note_ids
                ][:RAG_RETRIEVAL_LIMIT]
        except Exception:
            logger.warning("Ask semantic retrieval unavailable; continuing with local evidence")
        else:
            try:
                hits = rerank_chunks(retrieval_query, hits, settings=settings)
            except Exception:
                logger.warning("Ask semantic reranking unavailable; preserving Chroma order")
            accepted_count = _add_vector_hits_to_sources(
                hits,
                settings=settings,
                scope=scope,
                selected_note_ids=selected_note_ids,
                source_chunks=source_chunks,
                sources_by_note_id=sources_by_note_id,
                accepted_count=accepted_count,
            )
    accepted_count = _add_fuzzy_matches_to_sources(
        query,
        settings=settings,
        scope=scope,
        selected_note_ids=selected_note_ids,
        source_chunks=source_chunks,
        sources_by_note_id=sources_by_note_id,
        accepted_count=accepted_count,
    )
    if selected_note_ids is not None and len(selected_note_ids) <= RAG_SELECTED_NOTE_RESCUE_LIMIT:
        accepted_count = _add_selected_note_rescue_chunks(
            query,
            settings=settings,
            scope=scope,
            selected_note_ids=note_ids or [],
            source_chunks=source_chunks,
            sources_by_note_id=sources_by_note_id,
            accepted_count=accepted_count,
        )

    sources = tuple(
        RagSource(
            note_id=source.note_id,
            title=source.title,
            date_added=source.date_added,
            tags=source.tags,
            chunks=tuple(source_chunks[source.note_id]),
        )
        for source in sources_by_note_id.values()
    )
    return RagRetrievalContext(sources=sources, formatted_context=_format_context(sources))


def _add_vector_hits_to_sources(
    hits,
    *,
    settings: Settings,
    scope: CategoryScope,
    selected_note_ids: set[int] | None,
    source_chunks: dict[int, list[RagContextChunk]],
    sources_by_note_id: dict[int, RagSource],
    accepted_count: int,
) -> int:
    for hit in hits:
        if accepted_count >= RAG_FINAL_CHUNK_LIMIT:
            break

        note_id = _metadata_int(hit.metadata.get("note_id"))
        if note_id is None:
            continue
        chunk_index = _metadata_int(hit.metadata.get("chunk_index"))
        if chunk_index is None:
            continue
        chunk_id = build_chunk_id(note_id=note_id, chunk_index=chunk_index)
        if selected_note_ids is not None and note_id not in selected_note_ids:
            continue

        chunks = source_chunks.get(note_id)
        if chunks is not None and any(chunk.chunk_id == chunk_id for chunk in chunks):
            continue
        if chunks is not None and len(chunks) >= RAG_MAX_CHUNKS_PER_NOTE:
            continue

        note = get_note(settings.sqlite_path, note_id)
        if note is None or not _note_matches_scope(note, scope):
            continue

        if chunks is None:
            chunks = []
            source_chunks[note_id] = chunks
            sources_by_note_id[note_id] = RagSource(
                note_id=note.id,
                title=note.ai_title,
                date_added=note.date_added,
                tags=tuple(note.tags),
                chunks=(),
            )

        chunks.append(
            RagContextChunk(
                chunk_id=chunk_id,
                chunk_index=chunk_index,
                text=hit.text,
                distance=hit.distance,
                match_type="semantic",
                chunk_type=_metadata_chunk_type(hit.metadata.get("chunk_type")),
                source_start=_metadata_source_offset(hit.metadata.get("source_start")),
                source_end=_metadata_source_offset(hit.metadata.get("source_end")),
            )
        )
        accepted_count += 1

    return accepted_count


def _add_exact_matches_to_sources(
    query: str,
    *,
    settings: Settings,
    scope: CategoryScope,
    selected_note_ids: set[int] | None,
    source_chunks: dict[int, list[RagContextChunk]],
    sources_by_note_id: dict[int, RagSource],
    accepted_count: int,
) -> int:
    matches = search_notes_exact_matches(
        settings.sqlite_path,
        query,
        limit=RAG_LOCAL_MATCH_LIMIT,
        category_scope=scope,
    )
    query_text = query.casefold()
    body_matches = [match for match in matches if query_text in match.note.original_text.casefold()]
    non_body_matches = [match for match in matches if match not in body_matches]
    for match in [*body_matches, *non_body_matches]:
        if accepted_count >= RAG_FINAL_CHUNK_LIMIT:
            break
        if selected_note_ids is not None and match.note.id not in selected_note_ids:
            continue

        accepted_count = _add_note_chunk_to_sources(
            query,
            match=match,
            match_type="exact",
            scope=scope,
            source_chunks=source_chunks,
            sources_by_note_id=sources_by_note_id,
            accepted_count=accepted_count,
        )

    return accepted_count


def _add_fuzzy_matches_to_sources(
    query: str,
    *,
    settings: Settings,
    scope: CategoryScope,
    selected_note_ids: set[int] | None,
    source_chunks: dict[int, list[RagContextChunk]],
    sources_by_note_id: dict[int, RagSource],
    accepted_count: int,
) -> int:
    if accepted_count >= RAG_FINAL_CHUNK_LIMIT:
        return accepted_count

    notes = list_notes(
        settings.sqlite_path,
        category_id=scope.category_id,
        uncategorized=scope.uncategorized,
    )
    choices: dict[str, str] = {}
    notes_by_id = {note.id: note for note in notes}
    for note in notes:
        if selected_note_ids is not None and note.id not in selected_note_ids:
            continue

        choices[f"{note.id}:title"] = note.ai_title
        choices[f"{note.id}:tags"] = tags_to_text(note.tags)

    raw_matches = sorted(
        ((key, _partial_fuzzy_score(query, choice)) for key, choice in choices.items()),
        key=lambda match: match[1],
        reverse=True,
    )[: RAG_LOCAL_MATCH_LIMIT * 4]
    seen_note_ids: set[int] = set()
    for key, score in raw_matches:
        if accepted_count >= RAG_FINAL_CHUNK_LIMIT:
            break
        if score < RAG_FUZZY_SCORE_CUTOFF:
            continue

        note_id_text = str(key).split(":", maxsplit=1)[0]
        if not note_id_text.isdecimal():
            continue
        note_id = int(note_id_text)
        if note_id in seen_note_ids:
            continue
        seen_note_ids.add(note_id)

        note = notes_by_id.get(note_id)
        if note is None:
            continue

        accepted_count = _add_note_chunk_to_sources(
            query,
            match=ExactSearchMatch(note=note, matched_snippet=None),
            match_type="fuzzy",
            scope=scope,
            source_chunks=source_chunks,
            sources_by_note_id=sources_by_note_id,
            accepted_count=accepted_count,
        )

    return accepted_count


def _partial_fuzzy_score(query: str, choice: str) -> float:
    normalized_query = query.casefold().strip()
    normalized_choice = choice.casefold().strip()
    if not normalized_query or not normalized_choice:
        return 0.0
    if normalized_query in normalized_choice:
        return 100.0
    if len(normalized_choice) <= len(normalized_query):
        return SequenceMatcher(None, normalized_query, normalized_choice).ratio() * 100

    window_width = len(normalized_query)
    return max(
        SequenceMatcher(
            None,
            normalized_query,
            normalized_choice[start : start + window_width],
        ).ratio()
        * 100
        for start in range(0, len(normalized_choice) - window_width + 1)
    )


def _add_note_chunk_to_sources(
    query: str,
    *,
    match: ExactSearchMatch,
    match_type: RagMatchType,
    scope: CategoryScope,
    source_chunks: dict[int, list[RagContextChunk]],
    sources_by_note_id: dict[int, RagSource],
    accepted_count: int,
) -> int:
    note = match.note
    if not _note_matches_scope(note, scope):
        return accepted_count

    chunks = source_chunks.get(note.id)
    if chunks is not None and len(chunks) >= RAG_MAX_CHUNKS_PER_NOTE:
        return accepted_count

    retrieval_chunk = _best_local_chunk_for_note(query, note, match.matched_snippet)
    if retrieval_chunk is None:
        return accepted_count
    local_chunk_id = build_chunk_id(note_id=note.id, chunk_index=retrieval_chunk.chunk_index)
    if chunks is not None and any(
        chunk.chunk_id == local_chunk_id or chunk.text == retrieval_chunk.text for chunk in chunks
    ):
        return accepted_count

    if chunks is None:
        chunks = []
        source_chunks[note.id] = chunks
        sources_by_note_id[note.id] = RagSource(
            note_id=note.id,
            title=note.ai_title,
            date_added=note.date_added,
            tags=tuple(note.tags),
            chunks=(),
        )

    chunks.append(
        _context_chunk_from_retrieval_chunk(
            retrieval_chunk,
            match_type=match_type,
            chunk_id=local_chunk_id,
        )
    )
    return accepted_count + 1


def _add_selected_note_rescue_chunks(
    query: str,
    *,
    settings: Settings,
    scope: CategoryScope,
    selected_note_ids: Sequence[int],
    source_chunks: dict[int, list[RagContextChunk]],
    sources_by_note_id: dict[int, RagSource],
    accepted_count: int,
) -> int:
    for note_id in selected_note_ids:
        if accepted_count >= RAG_FINAL_CHUNK_LIMIT:
            break
        note = get_note(settings.sqlite_path, note_id)
        if note is None or not _note_matches_scope(note, scope):
            continue

        chunks = source_chunks.get(note.id)
        if chunks is not None and len(chunks) >= RAG_MAX_CHUNKS_PER_NOTE:
            continue

        rescue_chunk = _best_rescue_chunk_for_note(query, note)
        if rescue_chunk is None:
            continue
        rescue_chunk_id = build_chunk_id(note_id=note.id, chunk_index=rescue_chunk.chunk_index)
        if chunks is not None and any(chunk.chunk_id == rescue_chunk_id for chunk in chunks):
            continue

        if chunks is None:
            chunks = []
            source_chunks[note.id] = chunks
            sources_by_note_id[note.id] = RagSource(
                note_id=note.id,
                title=note.ai_title,
                date_added=note.date_added,
                tags=tuple(note.tags),
                chunks=(),
            )

        chunks.append(
            _context_chunk_from_retrieval_chunk(
                rescue_chunk,
                match_type="selected",
                chunk_id=rescue_chunk_id,
            )
        )
        accepted_count += 1

    return accepted_count


def _best_rescue_chunk_for_note(query: str, note):
    chunks = retrieval_index.retrieval_chunks_for_note(note)
    if not chunks:
        return None

    return max(chunks, key=lambda chunk: _chunk_rescue_score(query, chunk.text))


def _best_local_chunk_for_note(
    query: str,
    note,
    matched_snippet: str | None,
) -> RetrievalChunk | None:
    chunks = retrieval_index.retrieval_chunks_for_note(note)
    if not chunks:
        return None

    needle = (matched_snippet or query).casefold()
    for chunk in chunks:
        if needle and needle in chunk.text.casefold():
            return chunk

    return max(chunks, key=lambda chunk: _chunk_rescue_score(query, chunk.text))


def _context_chunk_from_retrieval_chunk(
    chunk: RetrievalChunk,
    *,
    match_type: RagMatchType,
    chunk_id: str,
) -> RagContextChunk:
    return RagContextChunk(
        chunk_id=chunk_id,
        chunk_index=chunk.chunk_index,
        text=chunk.text,
        distance=None,
        match_type=match_type,
        chunk_type=chunk.chunk_type,
        source_start=chunk.source_start,
        source_end=chunk.source_end,
    )


def _chunk_rescue_score(query: str, chunk_text: str) -> tuple[int, int]:
    query_terms = _significant_terms(query)
    chunk_terms = _significant_terms(chunk_text)
    overlap = len(query_terms & chunk_terms)
    return (overlap, -len(chunk_text))


def _significant_terms(text: str) -> set[str]:
    return {
        term
        for term in re.findall(r"[A-Za-z0-9][A-Za-z0-9_-]{2,}", text.casefold())
        if term not in {"the", "and", "for", "from", "with", "that", "this", "what"}
    }


def build_retrieval_query(question: str) -> str:
    return question[-4000:]


def _query_hits(
    vector_store: ChromaVectorStore,
    embedding: Sequence[float],
    *,
    where: dict[str, Any] | None,
    fallback_where: dict[str, Any] | None,
):
    try:
        return vector_store.query_by_embedding(
            embedding,
            limit=RAG_RETRIEVAL_LIMIT,
            where=where,
        )
    except Exception:
        if not _uses_note_id_filter(where):
            raise

    return vector_store.query_by_embedding(
        embedding,
        limit=RAG_FALLBACK_RETRIEVAL_LIMIT,
        where=fallback_where,
    )


def _combined_chroma_where(
    *,
    category_scope: CategoryScope,
    note_ids: Sequence[int] | None,
) -> dict[str, Any] | None:
    note_id_where = _note_id_chroma_where(note_ids)
    category_where = category_scope.chroma_where
    if category_where is not None and note_id_where is not None:
        return {"$and": [category_where, note_id_where]}
    return note_id_where or category_where


def _note_id_chroma_where(note_ids: Sequence[int] | None) -> dict[str, Any] | None:
    if note_ids is None:
        return None
    return {"note_id": {"$in": list(note_ids)}}


def _uses_note_id_filter(where: dict[str, Any] | None) -> bool:
    if where is None:
        return False
    if "note_id" in where:
        return True
    filters = where.get("$and")
    return isinstance(filters, list) and any(_uses_note_id_filter(item) for item in filters)


def _metadata_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdecimal():
        return int(value)
    return None


def _metadata_source_offset(value: object) -> int | None:
    offset = _metadata_int(value)
    if offset is None or offset < 0:
        return None
    return offset


def _metadata_chunk_type(value: object) -> ChunkType | None:
    if value == "full" or value == "summary" or value == "content":
        return cast(ChunkType, value)
    return None


def _format_context(sources: tuple[RagSource, ...]) -> str:
    return "\n\n---\n\n".join(_format_source(source) for source in sources)


def _format_source(source: RagSource) -> str:
    tags = ", ".join(source.tags) if source.tags else "none"
    lines = [
        f"Card title: {source.title}",
        f"Date added: {source.date_added}",
        f"Tags: {tags}",
    ]
    for chunk in source.chunks:
        lines.extend([f"Evidence ID: {chunk.chunk_id}", "Relevant text:", chunk.text])
    return "\n".join(lines)


def _note_matches_scope(note, category_scope: CategoryScope) -> bool:
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
