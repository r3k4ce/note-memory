from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from mapping_memory import retrieval_index
from mapping_memory.embeddings import EmbeddingUnavailableError, embed_documents
from mapping_memory.notes import list_notes
from mapping_memory.provider_fingerprint import (
    chroma_fingerprint_path,
    expected_chroma_fingerprint,
    remove_provider_fingerprint,
    write_provider_fingerprint,
)
from mapping_memory.settings import Settings
from mapping_memory.vector_store import ChromaVectorStore

MISSING_API_KEY_MESSAGE = (
    "VOYAGE_API_KEY is required to rebuild Chroma embeddings. Embeddings require it."
)


@dataclass(frozen=True)
class ReindexSummary:
    notes_indexed: int
    chunks_indexed: int
    chroma_path: Path


def reindex_chroma(settings: Settings | None = None) -> ReindexSummary:
    app_settings = settings or Settings()
    if not app_settings.sqlite_path.exists():
        raise FileNotFoundError(f"SQLite database not found: {app_settings.sqlite_path}")

    notes = list_notes(app_settings.sqlite_path)
    vector_store = ChromaVectorStore(settings=app_settings)
    fingerprint_path = chroma_fingerprint_path(app_settings)
    remove_provider_fingerprint(fingerprint_path)
    vector_store.recreate_collection()
    chunks = [chunk for note in notes for chunk in retrieval_index.retrieval_chunks_for_note(note)]
    if app_settings.voyage_api_key is None:
        if chunks:
            raise EmbeddingUnavailableError(MISSING_API_KEY_MESSAGE)
        return ReindexSummary(
            notes_indexed=len(notes),
            chunks_indexed=0,
            chroma_path=app_settings.chroma_path,
        )

    if chunks:
        embeddings = embed_documents([chunk.text for chunk in chunks], settings=app_settings)
        vector_store.add_chunks(chunks, embeddings=embeddings)
    write_provider_fingerprint(fingerprint_path, expected_chroma_fingerprint(app_settings))

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


if __name__ == "__main__":
    raise SystemExit(main())
