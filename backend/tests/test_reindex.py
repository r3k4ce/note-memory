from pathlib import Path
from typing import Any, ClassVar

import pytest
from pydantic import SecretStr

from mapping_memory.db import init_db
from mapping_memory.embeddings import EmbeddingProviderError, EmbeddingUnavailableError
from mapping_memory.notes import create_note
from mapping_memory.reindex import reindex_chroma
from mapping_memory.settings import Settings


class FakeVectorStore:
    instances: ClassVar[list["FakeVectorStore"]] = []

    def __init__(self, *, settings: Settings) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.settings = settings
        self.instances.append(self)

    def recreate_collection(self) -> None:
        self.calls.append(("recreate", None))

    def add_chunks(self, chunks: list[Any], *, embeddings: list[list[float]]) -> None:
        self.calls.append(("add", (list(chunks), embeddings)))


def _settings(tmp_path: Path, *, with_key: bool = True) -> Settings:
    return Settings(
        sqlite_path=tmp_path / "notes.sqlite",
        chroma_path=tmp_path / "chroma",
        voyage_api_key=SecretStr("test-key") if with_key else None,
        voyage_embedding_dimensions=3,
    )


def test_reindex_recreates_embeds_documents_adds_and_writes_fingerprint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = _settings(tmp_path)
    init_db(settings.sqlite_path)
    create_note(settings.sqlite_path, "A body", ai_title="A note")
    embedding_calls: list[list[str]] = []

    def embed_documents(texts: list[str], *, settings: Settings) -> list[list[float]]:
        embedding_calls.append(texts)
        return [[0.1, 0.2, 0.3] for _ in texts]

    FakeVectorStore.instances = []
    monkeypatch.setattr("mapping_memory.reindex.embed_documents", embed_documents, raising=False)
    monkeypatch.setattr("mapping_memory.reindex.ChromaVectorStore", FakeVectorStore)

    summary = reindex_chroma(settings)

    store = FakeVectorStore.instances[0]
    assert [name for name, _ in store.calls] == ["recreate", "add"]
    chunks, embeddings = store.calls[1][1]
    assert embedding_calls == [[chunk.text for chunk in chunks]]
    assert embeddings == [[0.1, 0.2, 0.3]]
    assert summary.notes_indexed == 1
    assert summary.chunks_indexed == 1
    assert (settings.chroma_path / "index-provider.json").is_file()


def test_reindex_recreates_before_embedding_and_writes_no_fingerprint_on_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = _settings(tmp_path)
    init_db(settings.sqlite_path)
    create_note(settings.sqlite_path, "A body")
    calls: list[str] = []

    class OrderedStore(FakeVectorStore):
        def recreate_collection(self) -> None:
            calls.append("recreate")

    def embed_documents(*_args: Any, **_kwargs: Any) -> list[list[float]]:
        calls.append("embed")
        raise EmbeddingProviderError("sanitized failure")

    monkeypatch.setattr("mapping_memory.reindex.embed_documents", embed_documents, raising=False)
    monkeypatch.setattr("mapping_memory.reindex.ChromaVectorStore", OrderedStore)

    with pytest.raises(EmbeddingProviderError):
        reindex_chroma(settings)

    assert calls == ["recreate", "embed"]
    assert not (settings.chroma_path / "index-provider.json").exists()


def test_reindex_missing_voyage_key_discards_collection_before_failing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = _settings(tmp_path, with_key=False)
    init_db(settings.sqlite_path)
    create_note(settings.sqlite_path, "A body")
    FakeVectorStore.instances = []
    monkeypatch.setattr("mapping_memory.reindex.ChromaVectorStore", FakeVectorStore)

    with pytest.raises(EmbeddingUnavailableError, match="VOYAGE_API_KEY"):
        reindex_chroma(settings)

    assert FakeVectorStore.instances[0].calls == [("recreate", None)]
    assert not (settings.chroma_path / "index-provider.json").exists()


def test_empty_reindex_with_voyage_key_writes_completed_fingerprint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = _settings(tmp_path)
    init_db(settings.sqlite_path)
    FakeVectorStore.instances = []
    monkeypatch.setattr("mapping_memory.reindex.ChromaVectorStore", FakeVectorStore)

    summary = reindex_chroma(settings)

    assert summary.chunks_indexed == 0
    assert FakeVectorStore.instances[0].calls == [("recreate", None)]
    assert (settings.chroma_path / "index-provider.json").is_file()
