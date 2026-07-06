import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from mapping_memory.category_scope import CategoryScope
from mapping_memory.chunking import create_retrieval_chunks
from mapping_memory.embeddings import embed_texts
from mapping_memory.notes import get_note, list_notes
from mapping_memory.schemas import AskHistoryMessage
from mapping_memory.settings import Settings
from mapping_memory.vector_store import ChromaVectorStore

RAG_RETRIEVAL_LIMIT = 20
RAG_FALLBACK_RETRIEVAL_LIMIT = 100
RAG_MAX_CHUNKS_PER_NOTE = 2
RAG_FINAL_CHUNK_LIMIT = 8
RAG_SELECTED_NOTE_RESCUE_LIMIT = 5

RagMatchType = Literal["semantic", "exact", "fuzzy", "selected"]


@dataclass(frozen=True)
class RagContextChunk:
    chunk_id: str
    chunk_index: int | None
    text: str
    distance: float | None
    match_type: RagMatchType = "semantic"


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
    history: list[AskHistoryMessage] | None = None,
) -> RagRetrievalContext:
    query = question.strip()
    if not query:
        raise ValueError("question must not be empty")
    if note_ids == []:
        return RagRetrievalContext(sources=(), formatted_context="")

    scope = category_scope or CategoryScope()
    selected_note_ids = set(note_ids) if note_ids is not None else None
    retrieval_query = build_retrieval_query(query, history or [])
    embedding = embed_texts([retrieval_query], settings=settings)[0]
    vector_store = ChromaVectorStore(settings=settings)
    _sync_scope_category_metadata(vector_store, settings=settings, category_scope=scope)
    where = _combined_chroma_where(category_scope=scope, note_ids=note_ids)
    hits = _query_hits(vector_store, embedding, where=where, fallback_where=scope.chroma_where)

    source_chunks: dict[int, list[RagContextChunk]] = {}
    sources_by_note_id: dict[int, RagSource] = {}
    accepted_count = 0

    accepted_count = _add_vector_hits_to_sources(
        hits,
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
        if selected_note_ids is not None and note_id not in selected_note_ids:
            continue

        chunks = source_chunks.get(note_id)
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
                chunk_id=hit.id,
                chunk_index=_metadata_int(hit.metadata.get("chunk_index")),
                text=hit.text,
                distance=hit.distance,
                match_type="semantic",
            )
        )
        accepted_count += 1

    return accepted_count


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
        if chunks is not None and any(chunk.text == rescue_chunk.text for chunk in chunks):
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
            RagContextChunk(
                chunk_id=f"note:{note.id}:selected:{rescue_chunk.chunk_index}",
                chunk_index=rescue_chunk.chunk_index,
                text=rescue_chunk.text,
                distance=None,
                match_type="selected",
            )
        )
        accepted_count += 1

    return accepted_count


def _best_rescue_chunk_for_note(query: str, note):
    chunks = _chunks_for_note(note)
    if not chunks:
        return None

    return max(chunks, key=lambda chunk: _chunk_rescue_score(query, chunk.text))


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


def build_retrieval_query(question: str, history: list[AskHistoryMessage]) -> str:
    recent = history[-6:]
    parts = [f"{message.role}: {message.content}" for message in recent]
    parts.append(f"user: {question}")
    return "\n".join(parts)[-4000:]


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
        lines.extend(["Relevant text:", chunk.text])
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
    chunks = [chunk for note in notes for chunk in _chunks_for_note(note)]
    vector_store.update_chunk_metadata(chunks)


def _chunks_for_note(note):
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
