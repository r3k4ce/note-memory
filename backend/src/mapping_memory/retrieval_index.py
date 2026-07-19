import logging

from mapping_memory.chunking import RetrievalChunk, create_retrieval_chunks
from mapping_memory.embeddings import embed_documents
from mapping_memory.notes import list_notes
from mapping_memory.provider_fingerprint import (
    chroma_fingerprint_compatible,
    chroma_fingerprint_path,
    chroma_index_ready,
    remove_provider_fingerprint,
)
from mapping_memory.schemas import NoteRead
from mapping_memory.settings import Settings
from mapping_memory.vector_store import ChromaVectorStore, build_chunk_id, build_chunk_metadata

logger = logging.getLogger(__name__)


def retrieval_chunks_for_note(note: NoteRead) -> list[RetrievalChunk]:
    return create_retrieval_chunks(
        note_id=note.id,
        original_text=note.original_text,
        ai_title=note.ai_title,
        short_summary=note.short_summary,
        tags=note.tags,
        date_added=note.date_added,
        category_id=note.category.id if note.category is not None else None,
        category_name=note.category.name if note.category is not None else None,
        updated_at=note.updated_at,
    )


def reconcile_chroma_with_sqlite(*, settings: Settings) -> None:
    try:
        notes = list_notes(settings.sqlite_path)
        expected_metadata = {
            build_chunk_id(
                note_id=chunk.note_id, chunk_index=chunk.chunk_index
            ): build_chunk_metadata(chunk)
            for note in notes
            for chunk in retrieval_chunks_for_note(note)
        }
        vector_store = ChromaVectorStore(settings=settings)
        current_metadata = vector_store.get_chunk_metadata()
        if chroma_fingerprint_compatible(settings) and current_metadata == expected_metadata:
            return

        remove_provider_fingerprint(chroma_fingerprint_path(settings))
        vector_store.recreate_collection()
        if settings.voyage_api_key is None:
            return

        from mapping_memory.reindex import reindex_chroma

        reindex_chroma(settings)
    except Exception:
        logger.warning("Chroma index reconciliation unavailable; continuing with existing index")


def reindex_note_for_retrieval(note: NoteRead, *, settings: Settings) -> None:
    if not chroma_index_ready(settings):
        return
    vector_store = ChromaVectorStore(settings=settings)
    try:
        vector_store.delete_chunks_for_note(note.id)
        chunks = retrieval_chunks_for_note(note)
        embeddings = embed_documents([chunk.text for chunk in chunks], settings=settings)
        vector_store.add_chunks(chunks, embeddings=embeddings)
    except Exception:
        remove_provider_fingerprint(chroma_fingerprint_path(settings))
        raise


def index_note_for_retrieval(note: NoteRead, *, settings: Settings) -> None:
    if not chroma_index_ready(settings):
        return
    try:
        chunks = retrieval_chunks_for_note(note)
        embeddings = embed_documents([chunk.text for chunk in chunks], settings=settings)
        ChromaVectorStore(settings=settings).add_chunks(chunks, embeddings=embeddings)
    except Exception:
        remove_provider_fingerprint(chroma_fingerprint_path(settings))
        raise


def delete_note_from_retrieval(note_id: int, *, settings: Settings) -> None:
    ChromaVectorStore(settings=settings).delete_chunks_for_note(note_id)
