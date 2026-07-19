import logging
from pathlib import Path
from typing import Any, ClassVar

import pytest
from pydantic import SecretStr

from mapping_memory.provider_fingerprint import (
    chroma_fingerprint_path,
    expected_chroma_fingerprint,
    write_provider_fingerprint,
)
from mapping_memory.retrieval_index import (
    delete_note_from_retrieval,
    index_note_for_retrieval,
    reconcile_chroma_with_sqlite,
    reindex_note_for_retrieval,
    retrieval_chunks_for_note,
)
from mapping_memory.schemas import CategoryRead, NoteRead
from mapping_memory.settings import Settings
from mapping_memory.vector_store import build_chunk_id, build_chunk_metadata


def _note(*, category: CategoryRead | None = None) -> NoteRead:
    return NoteRead(
        id=7,
        original_text="A note body",
        ai_title="A note",
        short_summary="A short summary.",
        tags=["mapping", "memory"],
        date_added="2026-07-01T10:00:00+00:00",
        updated_at="2026-07-02T11:00:00+00:00",
        category=category,
        needs_ai_organization=False,
    )


def test_retrieval_chunks_for_note_maps_all_note_metadata() -> None:
    category = CategoryRead(
        id=3,
        name="Projects",
        slug="projects",
        created_at="2026-07-01T09:00:00+00:00",
        updated_at="2026-07-01T09:00:00+00:00",
    )

    chunks = retrieval_chunks_for_note(_note(category=category))

    assert len(chunks) == 1
    chunk = chunks[0]
    assert chunk.note_id == 7
    assert chunk.title == "A note"
    assert chunk.tags == ("mapping", "memory")
    assert chunk.date_added == "2026-07-01T10:00:00+00:00"
    assert chunk.category_id == 3
    assert chunk.category_name == "Projects"
    assert chunk.updated_at == "2026-07-02T11:00:00+00:00"
    assert "Summary: A short summary." in chunk.text
    assert "Chunk: A note body" in chunk.text


class FakeVectorStore:
    instances: ClassVar[list["FakeVectorStore"]] = []
    current_metadata: ClassVar[dict[str, dict[str, Any]]] = {}

    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings
        self.calls: list[tuple[str, Any]] = []
        FakeVectorStore.instances.append(self)

    def get_chunk_metadata(self) -> dict[str, dict[str, Any]]:
        self.calls.append(("get_chunk_metadata", None))
        return self.current_metadata

    def delete_chunks_for_note(self, note_id: int) -> None:
        self.calls.append(("delete_chunks_for_note", note_id))

    def add_chunks(self, chunks: list[Any], *, embeddings: list[list[float]]) -> None:
        self.calls.append(("add_chunks", (list(chunks), embeddings)))

    def recreate_collection(self) -> None:
        self.calls.append(("recreate_collection", None))


def _ready_settings(tmp_path: Path) -> Settings:
    settings = Settings(
        sqlite_path=tmp_path / "notes.sqlite",
        chroma_path=tmp_path / "chroma",
        voyage_api_key=SecretStr("test-key"),
        voyage_embedding_dimensions=3,
    )
    write_provider_fingerprint(
        chroma_fingerprint_path(settings), expected_chroma_fingerprint(settings)
    )
    return settings


def test_reconcile_skips_reindex_when_vector_metadata_matches_exactly(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    note = _note()
    chunk = retrieval_chunks_for_note(note)[0]
    FakeVectorStore.instances = []
    FakeVectorStore.current_metadata = {
        build_chunk_id(note_id=chunk.note_id, chunk_index=chunk.chunk_index): (
            build_chunk_metadata(chunk)
        )
    }
    reindex_calls: list[Settings] = []
    monkeypatch.setattr("mapping_memory.retrieval_index.list_notes", lambda path: [note])
    monkeypatch.setattr("mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore)
    monkeypatch.setattr(
        "mapping_memory.reindex.reindex_chroma",
        lambda settings: reindex_calls.append(settings),
    )
    settings = _ready_settings(tmp_path)

    reconcile_chroma_with_sqlite(settings=settings)

    assert reindex_calls == []
    assert FakeVectorStore.instances[0].calls == [("get_chunk_metadata", None)]


def test_reconcile_reindexes_when_vector_metadata_differs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    note = _note()
    FakeVectorStore.instances = []
    FakeVectorStore.current_metadata = {}
    reindex_calls: list[Settings] = []
    monkeypatch.setattr("mapping_memory.retrieval_index.list_notes", lambda path: [note])
    monkeypatch.setattr("mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore)
    monkeypatch.setattr(
        "mapping_memory.reindex.reindex_chroma",
        lambda settings: reindex_calls.append(settings),
    )
    settings = _ready_settings(tmp_path)

    reconcile_chroma_with_sqlite(settings=settings)

    assert reindex_calls == [settings]
    assert ("recreate_collection", None) in FakeVectorStore.instances[0].calls
    assert not chroma_fingerprint_path(settings).exists()


def test_reconcile_discards_legacy_collection_without_voyage_key(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeVectorStore.instances = []
    FakeVectorStore.current_metadata = {"legacy": {"note_id": 1}}
    reindex_calls: list[Settings] = []
    monkeypatch.setattr("mapping_memory.retrieval_index.list_notes", lambda path: [])
    monkeypatch.setattr("mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore)
    monkeypatch.setattr(
        "mapping_memory.reindex.reindex_chroma",
        lambda settings: reindex_calls.append(settings),
    )
    settings = Settings(
        sqlite_path=tmp_path / "notes.sqlite",
        chroma_path=tmp_path / "chroma",
        voyage_api_key=None,
    )

    reconcile_chroma_with_sqlite(settings=settings)

    assert reindex_calls == []
    assert FakeVectorStore.instances[0].calls == [
        ("get_chunk_metadata", None),
        ("recreate_collection", None),
    ]
    assert not chroma_fingerprint_path(settings).exists()


def test_reconcile_logs_and_swallows_failures(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(
        "mapping_memory.retrieval_index.list_notes",
        lambda path: (_ for _ in ()).throw(RuntimeError("sensitive failure")),
    )

    with caplog.at_level(logging.WARNING):
        reconcile_chroma_with_sqlite(
            settings=Settings(
                sqlite_path=tmp_path / "notes.sqlite",
                chroma_path=tmp_path / "chroma",
            )
        )

    assert "Chroma index reconciliation unavailable; continuing with existing index" in caplog.text
    assert "sensitive failure" not in caplog.text


def test_reconcile_invalidates_fingerprint_before_collection_recreation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingRecreationStore(FakeVectorStore):
        def recreate_collection(self) -> None:
            raise RuntimeError("recreation failed")

    settings = _ready_settings(tmp_path)
    FailingRecreationStore.current_metadata = {"legacy": {"note_id": 1}}
    monkeypatch.setattr("mapping_memory.retrieval_index.list_notes", lambda path: [])
    monkeypatch.setattr("mapping_memory.retrieval_index.ChromaVectorStore", FailingRecreationStore)

    reconcile_chroma_with_sqlite(settings=settings)

    assert not chroma_fingerprint_path(settings).exists()


def test_index_note_embeds_then_adds_chunks(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, Any]] = []
    FakeVectorStore.instances = []

    def embed_documents(texts: list[str], *, settings: Settings) -> list[list[float]]:
        calls.append(("embed_documents", texts))
        return [[0.1, 0.2, 0.3] for _ in texts]

    monkeypatch.setattr("mapping_memory.retrieval_index.embed_documents", embed_documents)
    monkeypatch.setattr("mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore)
    settings = _ready_settings(tmp_path)

    index_note_for_retrieval(_note(), settings=settings)

    chunks, embeddings = FakeVectorStore.instances[0].calls[0][1]
    assert calls == [("embed_documents", [chunks[0].text])]
    assert embeddings == [[0.1, 0.2, 0.3]]


def test_reindex_note_deletes_old_chunks_before_embedding_and_adding(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    class OrderedVectorStore(FakeVectorStore):
        def delete_chunks_for_note(self, note_id: int) -> None:
            calls.append(f"delete:{note_id}")

        def add_chunks(self, chunks: list[Any], *, embeddings: list[list[float]]) -> None:
            calls.append("add")

    def embed_documents(texts: list[str], *, settings: Settings) -> list[list[float]]:
        calls.append("embed")
        return [[0.1, 0.2, 0.3] for _ in texts]

    monkeypatch.setattr("mapping_memory.retrieval_index.embed_documents", embed_documents)
    monkeypatch.setattr("mapping_memory.retrieval_index.ChromaVectorStore", OrderedVectorStore)

    reindex_note_for_retrieval(_note(), settings=_ready_settings(tmp_path))

    assert calls == ["delete:7", "embed", "add"]


def test_failed_note_index_invalidates_completed_fingerprint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = _ready_settings(tmp_path)

    def embed_documents(*_args: Any, **_kwargs: Any) -> list[list[float]]:
        raise RuntimeError("failed")

    monkeypatch.setattr("mapping_memory.retrieval_index.embed_documents", embed_documents)
    monkeypatch.setattr("mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore)

    with pytest.raises(RuntimeError, match="failed"):
        index_note_for_retrieval(_note(), settings=settings)

    assert not chroma_fingerprint_path(settings).exists()


def test_delete_note_deletes_all_chunks_for_note(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeVectorStore.instances = []
    monkeypatch.setattr("mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore)

    delete_note_from_retrieval(7, settings=Settings(sqlite_path=tmp_path / "notes.sqlite"))

    assert FakeVectorStore.instances[0].calls == [("delete_chunks_for_note", 7)]
