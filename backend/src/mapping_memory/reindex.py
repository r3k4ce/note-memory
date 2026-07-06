from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from mapping_memory.chunking import RetrievalChunk, create_retrieval_chunks
from mapping_memory.embeddings import EmbeddingUnavailableError, embed_texts
from mapping_memory.notes import list_notes
from mapping_memory.settings import Settings
from mapping_memory.vector_store import ChromaVectorStore

MISSING_API_KEY_MESSAGE = (
    "OPENAI_API_KEY is required to rebuild Chroma embeddings. Embeddings require it."
)


@dataclass(frozen=True)
class ReindexSummary:
    notes_indexed: int
    chunks_indexed: int
    chroma_path: Path


def reindex_chroma(settings: Settings | None = None) -> ReindexSummary:
    app_settings = settings or Settings()
    if app_settings.openai_api_key is None:
        raise EmbeddingUnavailableError(MISSING_API_KEY_MESSAGE)
    if not app_settings.sqlite_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {app_settings.sqlite_path}")

    notes = list_notes(app_settings.sqlite_path)
    chunks = [_chunk for note in notes for _chunk in _chunks_for_note(note)]
    embeddings = (
        embed_texts([chunk.text for chunk in chunks], settings=app_settings) if chunks else []
    )

    vector_store = ChromaVectorStore(settings=app_settings)
    vector_store.recreate_collection()
    if chunks:
        vector_store.add_chunks(chunks, embeddings=embeddings)

    return ReindexSummary(
        notes_indexed=len(notes),
        chunks_indexed=len(chunks),
        chroma_path=app_settings.chroma_path,
    )


def main() -> int:
    try:
        summary = reindex_chroma()
    except EmbeddingUnavailableError as error:
        print(str(error), file=sys.stderr)
        return 1

    print(f"notes indexed: {summary.notes_indexed}")
    print(f"chunks indexed: {summary.chunks_indexed}")
    print(f"chroma path: {summary.chroma_path}")
    return 0


def _chunks_for_note(note) -> list[RetrievalChunk]:
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


if __name__ == "__main__":
    raise SystemExit(main())
