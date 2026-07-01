from dataclasses import dataclass

from mapping_memory.category_scope import CategoryScope
from mapping_memory.chunking import create_retrieval_chunks
from mapping_memory.embeddings import embed_texts
from mapping_memory.notes import get_note, list_notes
from mapping_memory.settings import Settings
from mapping_memory.vector_store import ChromaVectorStore

RAG_RETRIEVAL_LIMIT = 20
RAG_MAX_CHUNKS_PER_NOTE = 2
RAG_FINAL_CHUNK_LIMIT = 8


@dataclass(frozen=True)
class RagContextChunk:
    chunk_id: str
    chunk_index: int | None
    text: str
    distance: float | None


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
) -> RagRetrievalContext:
    query = question.strip()
    if not query:
        raise ValueError("question must not be empty")

    scope = category_scope or CategoryScope()
    embedding = embed_texts([query], settings=settings)[0]
    vector_store = ChromaVectorStore(settings=settings)
    _sync_scope_category_metadata(vector_store, settings=settings, category_scope=scope)
    hits = vector_store.query_by_embedding(
        embedding,
        limit=RAG_RETRIEVAL_LIMIT,
        where=scope.chroma_where,
    )

    source_chunks: dict[int, list[RagContextChunk]] = {}
    sources_by_note_id: dict[int, RagSource] = {}
    accepted_count = 0

    for hit in hits:
        if accepted_count >= RAG_FINAL_CHUNK_LIMIT:
            break

        note_id = _metadata_int(hit.metadata.get("note_id"))
        if note_id is None:
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
            )
        )
        accepted_count += 1

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
