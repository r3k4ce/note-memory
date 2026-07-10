import logging

from mapping_memory.chunking import RetrievalChunk, create_retrieval_chunks
from mapping_memory.embeddings import embed_texts
from mapping_memory.notes import list_notes
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
        current_metadata = ChromaVectorStore(settings=settings).get_chunk_metadata()
        if current_metadata == expected_metadata:
            return

        from mapping_memory.reindex import reindex_chroma

        reindex_chroma(settings)
    except Exception:
        logger.warning("Chroma index reconciliation unavailable; continuing with existing index")


def reindex_note_for_retrieval(note: NoteRead, *, settings: Settings) -> None:
    vector_store = ChromaVectorStore(settings=settings)
    vector_store.delete_chunks_for_note(note.id)
    chunks = retrieval_chunks_for_note(note)
    embeddings = embed_texts([chunk.text for chunk in chunks], settings=settings)
    vector_store.add_chunks(chunks, embeddings=embeddings)


def index_note_for_retrieval(note: NoteRead, *, settings: Settings) -> None:
    chunks = retrieval_chunks_for_note(note)
    embeddings = embed_texts([chunk.text for chunk in chunks], settings=settings)
    ChromaVectorStore(settings=settings).add_chunks(chunks, embeddings=embeddings)


def delete_note_from_retrieval(note_id: int, *, settings: Settings) -> None:
    ChromaVectorStore(settings=settings).delete_chunks_for_note(note_id)
