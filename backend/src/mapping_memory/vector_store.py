from __future__ import annotations

import json
from collections.abc import Sequence
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, cast

import chromadb
from chromadb.errors import NotFoundError

from mapping_memory.chunking import RetrievalChunk
from mapping_memory.settings import Settings

COLLECTION_NAME = "note_data_chunks"

MetadataValue = str | int | float | bool
ChunkMetadata = dict[str, MetadataValue]
MetadataWhere = dict[str, Any]

UNCATEGORIZED_CATEGORY_ID = 0
UNCATEGORIZED_CATEGORY_NAME = "Uncategorized"
UNCATEGORIZED_CATEGORY_SCOPE = "uncategorized"


def category_scope_value(category_id: int | None) -> str:
    if category_id is None:
        return UNCATEGORIZED_CATEGORY_SCOPE

    return f"category:{category_id}"


@dataclass(frozen=True)
class VectorSearchResult:
    id: str
    text: str
    metadata: dict[str, Any]
    distance: float | None


def build_chunk_id(*, note_id: int, chunk_index: int) -> str:
    return f"note:{note_id}:chunk:{chunk_index}"


def build_chunk_metadata(chunk: RetrievalChunk) -> ChunkMetadata:
    category_id = chunk.category_id or UNCATEGORIZED_CATEGORY_ID
    category_name = chunk.category_name or UNCATEGORIZED_CATEGORY_NAME
    return {
        "note_id": chunk.note_id,
        "chunk_index": chunk.chunk_index,
        "chunk_type": chunk.chunk_type,
        "ai_title": chunk.title,
        "tags": json.dumps(list(chunk.tags), separators=(",", ":")),
        "date_added": chunk.date_added,
        "category_id": category_id,
        "category_name": category_name,
        "category_scope": category_scope_value(chunk.category_id),
    }


class ChromaVectorStore:
    def __init__(
        self,
        *,
        settings: Settings | None = None,
        client: Any | None = None,
        collection_name: str = COLLECTION_NAME,
    ) -> None:
        app_settings = settings or Settings()
        chroma_client = client or chromadb.PersistentClient(path=str(app_settings.chroma_path))
        self._client = chroma_client
        self._collection_name = collection_name
        self.collection = chroma_client.get_or_create_collection(name=collection_name)

    def recreate_collection(self) -> None:
        with suppress(NotFoundError):
            self._client.delete_collection(self._collection_name)

        self.collection = self._client.get_or_create_collection(name=self._collection_name)

    def add_chunks(
        self,
        chunks: Sequence[RetrievalChunk],
        *,
        embeddings: Sequence[Sequence[float]],
    ) -> None:
        if len(chunks) != len(embeddings):
            raise ValueError("chunks and embeddings must have the same length")
        if not chunks:
            return

        self.collection.add(
            ids=[
                build_chunk_id(note_id=chunk.note_id, chunk_index=chunk.chunk_index)
                for chunk in chunks
            ],
            documents=[chunk.text for chunk in chunks],
            embeddings=[list(embedding) for embedding in embeddings],
            metadatas=[build_chunk_metadata(chunk) for chunk in chunks],
        )

    def query_by_embedding(
        self,
        embedding: Sequence[float],
        *,
        limit: int = 5,
        where: MetadataWhere | None = None,
    ) -> list[VectorSearchResult]:
        query_kwargs: dict[str, Any] = {
            "query_embeddings": [list(embedding)],
            "n_results": limit,
            "include": ["documents", "metadatas", "distances"],
        }
        if where is not None:
            query_kwargs["where"] = where

        response = cast(dict[str, Any], self.collection.query(**query_kwargs))
        return _normalize_query_response(response)

    def update_chunk_metadata(self, chunks: Sequence[RetrievalChunk]) -> None:
        if not chunks:
            return

        self.collection.update(
            ids=[
                build_chunk_id(note_id=chunk.note_id, chunk_index=chunk.chunk_index)
                for chunk in chunks
            ],
            metadatas=[build_chunk_metadata(chunk) for chunk in chunks],
        )

    def delete_chunks_for_note(self, note_id: int) -> None:
        self.collection.delete(where={"note_id": note_id})


def _normalize_query_response(response: dict[str, Any]) -> list[VectorSearchResult]:
    ids = response.get("ids", [[]])[0]
    documents = response.get("documents", [[]])[0]
    metadatas = response.get("metadatas", [[]])[0]
    distances = response.get("distances", [[]])[0]

    results: list[VectorSearchResult] = []
    for index, chunk_id in enumerate(ids):
        results.append(
            VectorSearchResult(
                id=chunk_id,
                text=documents[index] if index < len(documents) else "",
                metadata=metadatas[index] if index < len(metadatas) else {},
                distance=distances[index] if index < len(distances) else None,
            )
        )

    return results
