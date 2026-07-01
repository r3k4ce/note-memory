from pathlib import Path
from typing import Any, ClassVar

import pytest

from mapping_memory.category_scope import make_category_scope
from mapping_memory.db import init_db
from mapping_memory.notes import create_category, create_note
from mapping_memory.settings import Settings
from mapping_memory.vector_store import VectorSearchResult


class FakeVectorStore:
    results: ClassVar[list[VectorSearchResult]] = []
    calls: ClassVar[list[dict[str, Any]]] = []

    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings

    def update_chunk_metadata(self, chunks: list[Any]) -> None:
        self.calls.append(
            {"updated_chunks": [(chunk.note_id, chunk.chunk_index) for chunk in chunks]}
        )

    def query_by_embedding(
        self,
        embedding: list[float],
        *,
        limit: int = 5,
        where: dict[str, Any] | None = None,
    ) -> list[VectorSearchResult]:
        self.calls.append({"embedding": embedding, "limit": limit, "where": where})
        return self.results


@pytest.fixture
def sqlite_path(tmp_path: Path) -> Path:
    path = tmp_path / "rag.sqlite"
    init_db(path)
    return path


def test_prepare_retrieval_context_groups_chunks_by_note(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_note = create_note(
        sqlite_path,
        "First note body",
        ai_title="First card",
        tags=["alpha", "routing"],
    )
    second_note = create_note(sqlite_path, "Second note body", ai_title="Second card")
    settings = Settings(sqlite_path=sqlite_path, openai_api_key=None)
    _install_fakes(
        monkeypatch,
        [
            _hit(first_note.id, 0, "first chunk"),
            _hit(first_note.id, 1, "second chunk"),
            _hit(second_note.id, 0, "third chunk"),
        ],
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("source question", settings=settings)

    assert FakeVectorStore.calls == [{"embedding": [0.1, 0.2, 0.3], "limit": 20, "where": None}]
    assert [source.note_id for source in context.sources] == [first_note.id, second_note.id]
    assert [chunk.text for chunk in context.sources[0].chunks] == ["first chunk", "second chunk"]
    assert context.sources[0].title == "First card"
    assert context.sources[0].tags == ("alpha", "routing")
    assert "Card title: First card" in context.formatted_context
    assert f"Date added: {first_note.date_added}" in context.formatted_context
    assert "Tags: alpha, routing" in context.formatted_context
    assert "Relevant text:\nfirst chunk" in context.formatted_context


def test_prepare_retrieval_context_limits_chunks_per_note_and_final_chunk_count(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notes = [create_note(sqlite_path, f"Note {index}") for index in range(5)]
    settings = Settings(sqlite_path=sqlite_path, openai_api_key=None)
    _install_fakes(
        monkeypatch,
        [
            _hit(note.id, chunk_index, f"note {note.id} chunk {chunk_index}")
            for note in notes
            for chunk_index in range(3)
        ],
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("source question", settings=settings)
    chunks_by_note = {source.note_id: source.chunks for source in context.sources}

    assert sum(len(source.chunks) for source in context.sources) == 8
    assert all(len(chunks) <= 2 for chunks in chunks_by_note.values())


def test_prepare_retrieval_context_skips_invalid_or_missing_notes(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    note = create_note(sqlite_path, "Usable note")
    settings = Settings(sqlite_path=sqlite_path, openai_api_key=None)
    _install_fakes(
        monkeypatch,
        [
            VectorSearchResult("missing", "missing note", {"note_id": 999}, None),
            VectorSearchResult("invalid", "invalid note", {"note_id": True}, None),
            VectorSearchResult("blank", "blank metadata", {}, None),
            _hit(note.id, "2", "usable chunk"),
        ],
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("source question", settings=settings)

    assert [source.note_id for source in context.sources] == [note.id]
    assert context.sources[0].chunks[0].chunk_index == 2


def test_prepare_retrieval_context_filters_specific_category(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    category = create_category(sqlite_path, "Projects")
    included = create_note(
        sqlite_path, "Included note body", ai_title="Included", category_id=category.id
    )
    excluded = create_note(sqlite_path, "Excluded note body", ai_title="Excluded")
    settings = Settings(sqlite_path=sqlite_path, openai_api_key=None)
    _install_fakes(
        monkeypatch,
        [
            _hit(excluded.id, 0, "excluded chunk"),
            _hit(included.id, 0, "included chunk"),
        ],
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context(
        "source question",
        settings=settings,
        category_scope=make_category_scope(category_id=category.id),
    )

    assert [source.note_id for source in context.sources] == [included.id]
    assert FakeVectorStore.calls == [
        {"updated_chunks": [(included.id, 0)]},
        {
            "embedding": [0.1, 0.2, 0.3],
            "limit": 20,
            "where": {"category_scope": f"category:{category.id}"},
        },
    ]


def test_prepare_retrieval_context_filters_uncategorized_scope(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    category = create_category(sqlite_path, "Projects")
    included = create_note(sqlite_path, "Included loose note", ai_title="Included")
    excluded = create_note(
        sqlite_path, "Excluded project note", ai_title="Excluded", category_id=category.id
    )
    settings = Settings(sqlite_path=sqlite_path, openai_api_key=None)
    _install_fakes(
        monkeypatch,
        [
            _hit(excluded.id, 0, "excluded chunk"),
            _hit(included.id, 0, "included chunk"),
        ],
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context(
        "source question",
        settings=settings,
        category_scope=make_category_scope(uncategorized=True),
    )

    assert [source.note_id for source in context.sources] == [included.id]
    assert FakeVectorStore.calls == [
        {"updated_chunks": [(included.id, 0)]},
        {"embedding": [0.1, 0.2, 0.3], "limit": 20, "where": {"category_scope": "uncategorized"}},
    ]


def test_prepare_retrieval_context_returns_empty_context_cleanly(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(sqlite_path=sqlite_path, openai_api_key=None)
    _install_fakes(monkeypatch, [])

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("source question", settings=settings)

    assert context.sources == ()
    assert context.formatted_context == ""


def test_prepare_retrieval_context_rejects_blank_question(sqlite_path: Path) -> None:
    from mapping_memory.rag import prepare_retrieval_context

    with pytest.raises(ValueError, match="question must not be empty"):
        prepare_retrieval_context(" \n\t ", settings=Settings(sqlite_path=sqlite_path))


def _install_fakes(
    monkeypatch: pytest.MonkeyPatch,
    results: list[VectorSearchResult],
) -> None:
    def embed_texts(texts: list[str], *, settings: Settings) -> list[list[float]]:
        assert texts == ["source question"]
        assert settings.sqlite_path
        return [[0.1, 0.2, 0.3]]

    FakeVectorStore.results = results
    FakeVectorStore.calls = []
    monkeypatch.setattr("mapping_memory.rag.embed_texts", embed_texts, raising=False)
    monkeypatch.setattr("mapping_memory.rag.ChromaVectorStore", FakeVectorStore, raising=False)


def _hit(note_id: int, chunk_index: int | str, text: str) -> VectorSearchResult:
    return VectorSearchResult(
        id=f"note:{note_id}:chunk:{chunk_index}",
        text=text,
        metadata={"note_id": note_id, "chunk_index": chunk_index},
        distance=0.1,
    )
