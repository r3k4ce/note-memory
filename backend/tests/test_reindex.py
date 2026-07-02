from pathlib import Path
from typing import Any, ClassVar

import pytest
from pydantic import SecretStr

from mapping_memory.db import init_db
from mapping_memory.embeddings import EmbeddingUnavailableError
from mapping_memory.notes import create_category, create_note
from mapping_memory.reindex import reindex_chroma
from mapping_memory.settings import Settings


class FakeVectorStore:
    instances: ClassVar[list["FakeVectorStore"]] = []

    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings
        self.calls: list[dict[str, Any]] = []
        FakeVectorStore.instances.append(self)

    def recreate_collection(self) -> None:
        self.calls.append({"method": "recreate_collection"})

    def add_chunks(self, chunks: list[Any], *, embeddings: list[list[float]]) -> None:
        self.calls.append(
            {"method": "add_chunks", "chunks": list(chunks), "embeddings": embeddings}
        )


def test_reindex_rebuilds_all_sqlite_notes(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    chroma_path = tmp_path / "chroma"
    init_db(sqlite_path)
    category = create_category(sqlite_path, "Projects")
    create_note(
        sqlite_path,
        "Categorized note body",
        ai_title="Project note",
        short_summary="Project summary.",
        tags=["project"],
        category_id=category.id,
    )
    create_note(
        sqlite_path,
        "Loose note body",
        ai_title="Loose note",
        short_summary="Loose summary.",
        tags=["loose"],
    )
    embedding_calls: list[list[str]] = []

    def embed_texts(texts: list[str], *, settings: Settings) -> list[list[float]]:
        embedding_calls.append(texts)
        return [[float(index), 0.2, 0.3] for index, _text in enumerate(texts)]

    FakeVectorStore.instances = []
    monkeypatch.setattr("mapping_memory.reindex.embed_texts", embed_texts, raising=False)
    monkeypatch.setattr("mapping_memory.reindex.ChromaVectorStore", FakeVectorStore, raising=False)

    summary = reindex_chroma(
        Settings(
            sqlite_path=sqlite_path,
            chroma_path=chroma_path,
            openai_api_key=SecretStr("test-key"),
        )
    )

    assert summary.notes_indexed == 2
    assert summary.chunks_indexed == 2
    assert summary.chroma_path == chroma_path
    assert len(FakeVectorStore.instances) == 1
    assert [call["method"] for call in FakeVectorStore.instances[0].calls] == [
        "recreate_collection",
        "add_chunks",
    ]
    add_call = FakeVectorStore.instances[0].calls[1]
    chunks = add_call["chunks"]
    assert [chunk.title for chunk in chunks] == ["Loose note", "Project note"]
    assert chunks[0].category_id is None
    assert chunks[0].category_name is None
    assert chunks[1].category_id == category.id
    assert chunks[1].category_name == "Projects"
    assert embedding_calls == [[chunk.text for chunk in chunks]]
    assert add_call["embeddings"] == [[0.0, 0.2, 0.3], [1.0, 0.2, 0.3]]


def test_reindex_embeds_before_recreating_collection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    create_note(sqlite_path, "Body")
    calls: list[str] = []

    def embed_texts(texts: list[str], *, settings: Settings) -> list[list[float]]:
        calls.append("embed")
        return [[0.1, 0.2, 0.3] for _text in texts]

    class OrderedFakeVectorStore(FakeVectorStore):
        def recreate_collection(self) -> None:
            calls.append("recreate")

        def add_chunks(self, chunks: list[Any], *, embeddings: list[list[float]]) -> None:
            calls.append("add")

    monkeypatch.setattr("mapping_memory.reindex.embed_texts", embed_texts, raising=False)
    monkeypatch.setattr(
        "mapping_memory.reindex.ChromaVectorStore", OrderedFakeVectorStore, raising=False
    )

    reindex_chroma(Settings(sqlite_path=sqlite_path, openai_api_key=SecretStr("test-key")))

    assert calls == ["embed", "recreate", "add"]


def test_reindex_missing_openai_key_fails_before_chroma(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    create_note(sqlite_path, "Body")

    def create_vector_store(*args: Any, **kwargs: Any) -> FakeVectorStore:
        raise AssertionError("Chroma should not be touched without OPENAI_API_KEY")

    monkeypatch.setattr(
        "mapping_memory.reindex.ChromaVectorStore", create_vector_store, raising=False
    )

    with pytest.raises(EmbeddingUnavailableError, match=r"OPENAI_API_KEY.*Embeddings require it"):
        reindex_chroma(Settings(sqlite_path=sqlite_path, openai_api_key=None))


def test_reindex_zero_notes_resets_to_empty_collection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)

    def embed_texts(texts: list[str], *, settings: Settings) -> list[list[float]]:
        raise AssertionError("No embedding call is needed when there are no chunks")

    FakeVectorStore.instances = []
    monkeypatch.setattr("mapping_memory.reindex.embed_texts", embed_texts, raising=False)
    monkeypatch.setattr("mapping_memory.reindex.ChromaVectorStore", FakeVectorStore, raising=False)

    summary = reindex_chroma(
        Settings(sqlite_path=sqlite_path, openai_api_key=SecretStr("test-key"))
    )

    assert summary.notes_indexed == 0
    assert summary.chunks_indexed == 0
    assert FakeVectorStore.instances[0].calls == [{"method": "recreate_collection"}]
