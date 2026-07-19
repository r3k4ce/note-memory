from pathlib import Path
from typing import Any

import pytest
from chromadb.errors import NotFoundError

from mapping_memory.chunking import RetrievalChunk
from mapping_memory.settings import Settings
from mapping_memory.vector_store import (
    COLLECTION_NAME,
    ChromaVectorStore,
    build_chunk_id,
    build_chunk_metadata,
)


class FakeCollection:
    def __init__(self) -> None:
        self.add_calls: list[dict[str, Any]] = []
        self.delete_calls: list[dict[str, Any]] = []
        self.get_calls: list[dict[str, Any]] = []
        self.query_calls: list[dict[str, Any]] = []
        self.update_calls: list[dict[str, Any]] = []
        self.count_value = 0
        self.get_response: dict[str, Any] = {
            "ids": [],
            "metadatas": [],
        }
        self.query_response: dict[str, Any] = {
            "ids": [["note:7:chunk:0"]],
            "documents": [["chunk text"]],
            "metadatas": [[{"note_id": 7, "chunk_index": 0}]],
            "distances": [[0.125]],
        }

    def add(self, **kwargs: Any) -> None:
        self.add_calls.append(kwargs)

    def delete(self, **kwargs: Any) -> None:
        self.delete_calls.append(kwargs)

    def count(self) -> int:
        return self.count_value

    def get(self, **kwargs: Any) -> dict[str, Any]:
        self.get_calls.append(kwargs)
        return self.get_response

    def query(self, **kwargs: Any) -> dict[str, Any]:
        self.query_calls.append(kwargs)
        return self.query_response

    def update(self, **kwargs: Any) -> None:
        self.update_calls.append(kwargs)


class FakeClient:
    def __init__(self, collection: FakeCollection) -> None:
        self.collection = collection
        self.collection_names: list[str] = []
        self.delete_collection_calls: list[str] = []
        self.delete_exception: Exception | None = None

    def get_or_create_collection(self, *, name: str) -> FakeCollection:
        self.collection_names.append(name)
        return self.collection

    def delete_collection(self, name: str) -> None:
        self.delete_collection_calls.append(name)
        if self.delete_exception is not None:
            raise self.delete_exception


def test_build_chunk_id_uses_stable_note_and_chunk_index() -> None:
    assert build_chunk_id(note_id=42, chunk_index=3) == "note:42:chunk:3"


def test_settings_resolves_relative_chroma_path() -> None:
    settings = Settings(voyage_api_key=None, chroma_path=Path("../data/test-chroma"))

    assert settings.chroma_path.is_absolute()
    assert settings.chroma_path.name == "test-chroma"


def test_build_chunk_metadata_uses_required_chroma_metadata_shape() -> None:
    chunk = RetrievalChunk(
        note_id=7,
        chunk_index=2,
        chunk_type="content",
        text="Title: Map\nChunk: Body",
        title="Map title",
        tags=("routing", "labels"),
        date_added="2026-06-30T23:30:00+00:00",
        source_start=0,
        source_end=12,
        category_id=3,
        category_name="Projects",
    )

    assert build_chunk_metadata(chunk) == {
        "note_id": 7,
        "chunk_index": 2,
        "chunk_type": "content",
        "ai_title": "Map title",
        "tags": '["routing","labels"]',
        "date_added": "2026-06-30T23:30:00+00:00",
        "source_start": 0,
        "source_end": 12,
        "category_id": 3,
        "category_name": "Projects",
        "category_scope": "category:3",
        "chunk_text_hash": "39c513383bc5c014a44b1761e53cf10f9c964e240222e6246b461c4a77676ec2",
        "note_updated_at": "2026-06-30T23:30:00+00:00",
    }


def test_build_chunk_metadata_uses_uncategorized_sentinel() -> None:
    chunk = RetrievalChunk(
        note_id=7,
        chunk_index=2,
        chunk_type="content",
        text="Title: Map\nChunk: Body",
        title="Map title",
        tags=("routing", "labels"),
        date_added="2026-06-30T23:30:00+00:00",
        source_start=0,
        source_end=12,
    )

    metadata = build_chunk_metadata(chunk)

    assert metadata["category_id"] == 0
    assert metadata["category_name"] == "Uncategorized"
    assert metadata["category_scope"] == "uncategorized"


def test_store_gets_or_creates_configured_collection() -> None:
    collection = FakeCollection()
    client = FakeClient(collection)

    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=client)

    assert store.collection is collection
    assert client.collection_names == [COLLECTION_NAME]


def test_add_chunks_sends_ids_documents_embeddings_and_metadata_to_chroma() -> None:
    collection = FakeCollection()
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=FakeClient(collection))
    chunks = [
        RetrievalChunk(
            note_id=9,
            chunk_index=0,
            chunk_type="summary",
            text="summary chunk text",
            title="Trip plan",
            tags=("travel",),
            date_added="2026-06-30T23:30:00+00:00",
            source_start=None,
            source_end=None,
        ),
        RetrievalChunk(
            note_id=9,
            chunk_index=1,
            chunk_type="content",
            text="content chunk text",
            title="Trip plan",
            tags=("travel",),
            date_added="2026-06-30T23:30:00+00:00",
            source_start=0,
            source_end=18,
        ),
    ]

    store.add_chunks(chunks, embeddings=[[0.1, 0.2], [0.3, 0.4]])

    assert collection.add_calls == [
        {
            "ids": ["note:9:chunk:0", "note:9:chunk:1"],
            "documents": ["summary chunk text", "content chunk text"],
            "embeddings": [[0.1, 0.2], [0.3, 0.4]],
            "metadatas": [
                {
                    "note_id": 9,
                    "chunk_index": 0,
                    "chunk_type": "summary",
                    "ai_title": "Trip plan",
                    "tags": '["travel"]',
                    "date_added": "2026-06-30T23:30:00+00:00",
                    "source_start": -1,
                    "source_end": -1,
                    "category_id": 0,
                    "category_name": "Uncategorized",
                    "category_scope": "uncategorized",
                    "chunk_text_hash": (
                        "89c9099d6dacc3c2091be47508fe47e637f4267e0252f61f878d0526355c2dba"
                    ),
                    "note_updated_at": "2026-06-30T23:30:00+00:00",
                },
                {
                    "note_id": 9,
                    "chunk_index": 1,
                    "chunk_type": "content",
                    "ai_title": "Trip plan",
                    "tags": '["travel"]',
                    "date_added": "2026-06-30T23:30:00+00:00",
                    "source_start": 0,
                    "source_end": 18,
                    "category_id": 0,
                    "category_name": "Uncategorized",
                    "category_scope": "uncategorized",
                    "chunk_text_hash": (
                        "4da1868548352163b4a4c17c36ef8d5f62940d76bfdc6ca3e9898b5f0905559d"
                    ),
                    "note_updated_at": "2026-06-30T23:30:00+00:00",
                },
            ],
        }
    ]


def test_count_chunks_returns_collection_count() -> None:
    collection = FakeCollection()
    collection.count_value = 3
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=FakeClient(collection))

    assert store.count_chunks() == 3


def test_get_chunk_metadata_returns_metadata_by_chunk_id() -> None:
    collection = FakeCollection()
    collection.get_response = {
        "ids": ["note:7:chunk:0", "note:8:chunk:0"],
        "metadatas": [{"note_id": 7}, {"note_id": 8}],
    }
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=FakeClient(collection))

    assert store.get_chunk_metadata() == {
        "note:7:chunk:0": {"note_id": 7},
        "note:8:chunk:0": {"note_id": 8},
    }
    assert collection.get_calls == [{"include": ["metadatas"]}]


def test_add_chunks_rejects_mismatched_embedding_count() -> None:
    collection = FakeCollection()
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=FakeClient(collection))
    chunk = RetrievalChunk(
        note_id=9,
        chunk_index=0,
        chunk_type="full",
        text="chunk text",
        title="Title",
        tags=(),
        date_added="2026-06-30T23:30:00+00:00",
        source_start=0,
        source_end=10,
    )

    with pytest.raises(ValueError, match="chunks and embeddings must have the same length"):
        store.add_chunks([chunk], embeddings=[])

    assert collection.add_calls == []


def test_query_by_embedding_returns_normalized_results() -> None:
    collection = FakeCollection()
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=FakeClient(collection))

    results = store.query_by_embedding([0.1, 0.2], limit=3)

    assert collection.query_calls == [
        {
            "query_embeddings": [[0.1, 0.2]],
            "n_results": 3,
            "include": ["documents", "metadatas", "distances"],
        }
    ]
    assert len(results) == 1
    assert results[0].id == "note:7:chunk:0"
    assert results[0].text == "chunk text"
    assert results[0].metadata == {"note_id": 7, "chunk_index": 0}
    assert results[0].distance == 0.125


def test_query_by_embedding_passes_metadata_filter_when_provided() -> None:
    collection = FakeCollection()
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=FakeClient(collection))

    store.query_by_embedding([0.1, 0.2], limit=3, where={"category_scope": "category:7"})

    assert collection.query_calls == [
        {
            "query_embeddings": [[0.1, 0.2]],
            "n_results": 3,
            "include": ["documents", "metadatas", "distances"],
            "where": {"category_scope": "category:7"},
        }
    ]


def test_update_chunk_metadata_updates_known_chunk_ids_only() -> None:
    collection = FakeCollection()
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=FakeClient(collection))
    chunk = RetrievalChunk(
        note_id=9,
        chunk_index=0,
        chunk_type="full",
        text="chunk text",
        title="Title",
        tags=(),
        date_added="2026-06-30T23:30:00+00:00",
        source_start=0,
        source_end=10,
        category_id=4,
        category_name="Work",
    )

    store.update_chunk_metadata([chunk])

    assert collection.update_calls == [
        {
            "ids": ["note:9:chunk:0"],
            "metadatas": [
                {
                    "note_id": 9,
                    "chunk_index": 0,
                    "chunk_type": "full",
                    "ai_title": "Title",
                    "tags": "[]",
                    "date_added": "2026-06-30T23:30:00+00:00",
                    "source_start": 0,
                    "source_end": 10,
                    "category_id": 4,
                    "category_name": "Work",
                    "category_scope": "category:4",
                    "chunk_text_hash": (
                        "ceb1ce3d817e249e7d8fbaf98faccd8ece37fa173e1671e2da78f459cb08a83f"
                    ),
                    "note_updated_at": "2026-06-30T23:30:00+00:00",
                }
            ],
        }
    ]


def test_delete_chunks_for_note_deletes_by_note_id_metadata() -> None:
    collection = FakeCollection()
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=FakeClient(collection))

    store.delete_chunks_for_note(7)

    assert collection.delete_calls == [{"where": {"note_id": 7}}]


def test_recreate_collection_deletes_and_reopens_collection() -> None:
    collection = FakeCollection()
    client = FakeClient(collection)
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=client)

    store.recreate_collection()

    assert client.delete_collection_calls == [COLLECTION_NAME]
    assert client.collection_names == [COLLECTION_NAME, COLLECTION_NAME]
    assert store.collection is collection


def test_recreate_collection_ignores_missing_collection_only() -> None:
    collection = FakeCollection()
    client = FakeClient(collection)
    client.delete_exception = NotFoundError("Collection does not exist")
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=client)

    store.recreate_collection()

    assert client.delete_collection_calls == [COLLECTION_NAME]
    assert client.collection_names == [COLLECTION_NAME, COLLECTION_NAME]


def test_recreate_collection_propagates_unexpected_chroma_errors() -> None:
    collection = FakeCollection()
    client = FakeClient(collection)
    client.delete_exception = RuntimeError("provider failed")
    store = ChromaVectorStore(settings=Settings(voyage_api_key=None), client=client)

    with pytest.raises(RuntimeError, match="provider failed"):
        store.recreate_collection()
