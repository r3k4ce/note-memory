from pathlib import Path
from typing import Any, ClassVar

import pytest

from mapping_memory.category_scope import make_category_scope
from mapping_memory.db import init_db
from mapping_memory.notes import create_category, create_note
from mapping_memory.schemas import AskHistoryMessage
from mapping_memory.settings import Settings
from mapping_memory.vector_store import VectorSearchResult


class FakeVectorStore:
    results: ClassVar[list[VectorSearchResult]] = []
    calls: ClassVar[list[dict[str, Any]]] = []
    query_errors: ClassVar[list[Exception]] = []

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
        if self.query_errors:
            raise self.query_errors.pop(0)
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
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
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


def test_build_retrieval_query_includes_current_question() -> None:
    from mapping_memory.rag import build_retrieval_query

    query = build_retrieval_query("What happened next?", [])

    assert query == "user: What happened next?"


def test_build_retrieval_query_includes_recent_history() -> None:
    from mapping_memory.rag import build_retrieval_query

    query = build_retrieval_query(
        "What about that?",
        [
            AskHistoryMessage(role="user", content="What did we save?"),
            AskHistoryMessage(role="assistant", content="A routing decision."),
        ],
    )

    assert query == (
        "user: What did we save?\nassistant: A routing decision.\nuser: What about that?"
    )


def test_build_retrieval_query_is_capped() -> None:
    from mapping_memory.rag import build_retrieval_query

    query = build_retrieval_query(
        "current question",
        [AskHistoryMessage(role="user", content="x" * 4000)],
    )

    assert len(query) == 4000
    assert query.endswith("user: current question")


def test_build_retrieval_query_uses_only_recent_history() -> None:
    from mapping_memory.rag import build_retrieval_query

    history = [AskHistoryMessage(role="user", content=f"message {index}") for index in range(8)]

    query = build_retrieval_query("current question", history)

    assert "message 0" not in query
    assert "message 1" not in query
    for index in range(2, 8):
        assert f"user: message {index}" in query
    assert query.endswith("user: current question")


def test_prepare_retrieval_context_embeds_recent_history_query(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    note = create_note(sqlite_path, "Included note body", ai_title="Included")
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(
        monkeypatch,
        [_hit(note.id, 0, "included chunk")],
        expected_query=(
            "user: What did we discuss?\n"
            "assistant: We discussed source recreation.\n"
            "user: source question"
        ),
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context(
        "source question",
        settings=settings,
        history=[
            AskHistoryMessage(role="user", content="What did we discuss?"),
            AskHistoryMessage(role="assistant", content="We discussed source recreation."),
        ],
    )

    assert [source.note_id for source in context.sources] == [note.id]


def test_prepare_retrieval_context_limits_chunks_per_note_and_final_chunk_count(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notes = [create_note(sqlite_path, f"Note {index}") for index in range(5)]
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
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


def test_prepare_retrieval_context_keeps_exact_evidence_ahead_of_full_semantic_budget(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exact_note = create_note(sqlite_path, "The exact decision is amber-42.", ai_title="Exact")
    semantic_notes = [create_note(sqlite_path, f"Semantic note {index}") for index in range(4)]
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(
        monkeypatch,
        [
            _hit(note.id, chunk_index, f"semantic {note.id}-{chunk_index}")
            for note in semantic_notes
            for chunk_index in range(2)
        ],
        expected_query="user: amber-42",
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("amber-42", settings=settings)

    assert context.sources[0].note_id == exact_note.id
    assert context.sources[0].chunks[0].match_type == "exact"
    assert sum(len(source.chunks) for source in context.sources) == 8


def test_prepare_retrieval_context_returns_exact_evidence_when_semantic_retrieval_fails(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    note = create_note(sqlite_path, "The local decision is amber-42.", ai_title="Exact")
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)

    def embed_query(*_args, **_kwargs):
        raise RuntimeError("semantic retrieval unavailable")

    monkeypatch.setattr(
        "mapping_memory.rag.chroma_index_ready", lambda settings: True, raising=False
    )
    monkeypatch.setattr("mapping_memory.rag.embed_query", embed_query, raising=False)

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("amber-42", settings=settings)

    assert [source.note_id for source in context.sources] == [note.id]
    assert context.sources[0].chunks[0].chunk_id == f"note:{note.id}:chunk:0"
    assert context.sources[0].chunks[0].match_type == "exact"


def test_prepare_retrieval_context_skips_invalid_or_missing_notes(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    note = create_note(sqlite_path, "Usable note")
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
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
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
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
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
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


def test_prepare_retrieval_context_filters_selected_note_ids(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    included = create_note(sqlite_path, "Included note body", ai_title="Included")
    excluded = create_note(sqlite_path, "Excluded note body", ai_title="Excluded")
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(
        monkeypatch,
        [
            _hit(excluded.id, 0, "excluded chunk"),
            _hit(included.id, 0, "included chunk"),
        ],
        expected_query=(
            "user: Which note is selected?\nassistant: The included note.\nuser: source question"
        ),
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context(
        "source question",
        settings=settings,
        history=[
            AskHistoryMessage(role="user", content="Which note is selected?"),
            AskHistoryMessage(role="assistant", content="The included note."),
        ],
        note_ids=[included.id],
    )

    assert [source.note_id for source in context.sources] == [included.id]
    assert [chunk.text for chunk in context.sources[0].chunks] == ["included chunk"]
    assert FakeVectorStore.calls == [
        {
            "embedding": [0.1, 0.2, 0.3],
            "limit": 20,
            "where": {"note_id": {"$in": [included.id]}},
        },
    ]


def test_prepare_retrieval_context_returns_empty_for_empty_selected_note_ids(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(monkeypatch, [_hit(1, 0, "unused chunk")])

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("source question", settings=settings, note_ids=[])

    assert context.sources == ()
    assert context.formatted_context == ""
    assert FakeVectorStore.calls == []


def test_prepare_retrieval_context_rescues_selected_note_context_when_vector_misses(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    selected = create_note(
        sqlite_path,
        (
            "Bun should answer from this selected note. "
            "The launch checklist needs QA before release."
        ),
        ai_title="Launch checklist",
        short_summary="QA before release.",
        tags=["launch"],
    )
    create_note(
        sqlite_path,
        "This unselected note must not be used for the answer.",
        ai_title="Unselected note",
    )
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(
        monkeypatch,
        [],
        expected_query="user: What does the launch checklist need before release?",
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context(
        "What does the launch checklist need before release?",
        settings=settings,
        note_ids=[selected.id],
    )

    assert [source.note_id for source in context.sources] == [selected.id]
    assert len(context.sources[0].chunks) == 1
    assert "launch checklist needs QA before release" in context.sources[0].chunks[0].text
    assert "Unselected note" not in context.formatted_context


def test_prepare_retrieval_context_adds_exact_local_evidence_when_vector_misses(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    note = create_note(
        sqlite_path,
        "The local-only deployment code is citron-427.",
        ai_title="Deployment code",
        tags=["release"],
    )
    create_note(sqlite_path, "Unrelated note body", ai_title="Other note")
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(monkeypatch, [], expected_query="user: citron-427")

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("citron-427", settings=settings)

    assert [source.note_id for source in context.sources] == [note.id]
    chunk = context.sources[0].chunks[0]
    assert chunk.match_type == "exact"
    assert chunk.chunk_type == "full"
    assert chunk.source_start == 0
    assert chunk.source_end == len(note.original_text)
    assert "citron-427" in context.formatted_context


def test_prepare_retrieval_context_adds_fuzzy_title_or_tag_evidence(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    note = create_note(
        sqlite_path,
        "Keep the rollout checklist short.",
        ai_title="Cerulean rollout checklist",
        tags=["launch-plan"],
    )
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(monkeypatch, [], expected_query="user: cerulean rolluot")

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("cerulean rolluot", settings=settings)

    assert [source.note_id for source in context.sources] == [note.id]
    assert context.sources[0].chunks[0].match_type == "fuzzy"


def test_prepare_retrieval_context_adds_selected_note_rescue_chunk_when_vector_hit_is_weak(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    selected = create_note(
        sqlite_path,
        (
            "The unrelated opening paragraph is about inbox cleanup.\n\n"
            "The launch checklist needs QA before release and signoff from Mira."
        ),
        ai_title="Launch checklist",
        short_summary="QA before release.",
        tags=["launch"],
    )
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(
        monkeypatch,
        [_hit(selected.id, 1, "semantic hit from selected note but not the answer")],
        expected_query="user: Who needs to sign off before release?",
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context(
        "Who needs to sign off before release?",
        settings=settings,
        note_ids=[selected.id],
    )

    assert [source.note_id for source in context.sources] == [selected.id]
    assert len(context.sources[0].chunks) == 2
    assert "semantic hit from selected note but not the answer" in context.formatted_context
    assert "signoff from Mira" in context.formatted_context


def test_prepare_retrieval_context_filters_category_and_selected_note_ids(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    category = create_category(sqlite_path, "Projects")
    included = create_note(
        sqlite_path, "Included note body", ai_title="Included", category_id=category.id
    )
    excluded_by_category = create_note(sqlite_path, "Wrong category", ai_title="Wrong category")
    excluded_by_selection = create_note(
        sqlite_path, "Wrong selected note", ai_title="Wrong selection", category_id=category.id
    )
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(
        monkeypatch,
        [
            _hit(excluded_by_category.id, 0, "excluded by category"),
            _hit(excluded_by_selection.id, 0, "excluded by selection"),
            _hit(included.id, 0, "included chunk"),
        ],
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context(
        "source question",
        settings=settings,
        category_scope=make_category_scope(category_id=category.id),
        note_ids=[included.id, excluded_by_category.id],
    )

    assert [source.note_id for source in context.sources] == [included.id]
    assert FakeVectorStore.calls == [
        {"updated_chunks": [(excluded_by_selection.id, 0), (included.id, 0)]},
        {
            "embedding": [0.1, 0.2, 0.3],
            "limit": 20,
            "where": {
                "$and": [
                    {"category_scope": f"category:{category.id}"},
                    {"note_id": {"$in": [included.id, excluded_by_category.id]}},
                ]
            },
        },
    ]


def test_prepare_retrieval_context_falls_back_when_note_id_filter_query_fails(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    included = create_note(sqlite_path, "Included note body", ai_title="Included")
    excluded = create_note(sqlite_path, "Excluded note body", ai_title="Excluded")
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(
        monkeypatch,
        [
            _hit(excluded.id, 0, "excluded chunk"),
            *[_hit(included.id, index, f"included chunk {index}") for index in range(25)],
        ],
        query_errors=[RuntimeError("unsupported filter")],
    )
    reranker_documents: list[str] = []

    def rerank_chunks(query, candidates, *, settings):
        reranker_documents.extend(candidate.text for candidate in candidates)
        return list(candidates)

    monkeypatch.setattr("mapping_memory.rag.rerank_chunks", rerank_chunks)

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context(
        "source question",
        settings=settings,
        note_ids=[included.id],
    )

    assert [source.note_id for source in context.sources] == [included.id]
    assert reranker_documents == [f"included chunk {index}" for index in range(20)]
    assert FakeVectorStore.calls == [
        {
            "embedding": [0.1, 0.2, 0.3],
            "limit": 20,
            "where": {"note_id": {"$in": [included.id]}},
        },
        {"embedding": [0.1, 0.2, 0.3], "limit": 100, "where": None},
    ]


def test_prepare_retrieval_context_returns_empty_context_cleanly(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = Settings(sqlite_path=sqlite_path, voyage_api_key=None)
    _install_fakes(monkeypatch, [])

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("source question", settings=settings)

    assert context.sources == ()
    assert context.formatted_context == ""


def test_prepare_retrieval_context_reranks_only_semantic_hits_with_history_query(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = create_note(sqlite_path, "First body", ai_title="First")
    second = create_note(sqlite_path, "Second body", ai_title="Second")
    hits = [_hit(first.id, 0, "complete first chunk"), _hit(second.id, 0, "complete second chunk")]
    captured: dict[str, Any] = {}
    _install_fakes(
        monkeypatch,
        hits,
        expected_query="user: Earlier question\nassistant: Earlier answer\nuser: Current question",
    )

    def rerank_chunks(query, candidates, *, settings):
        captured["query"] = query
        captured["documents"] = [candidate.text for candidate in candidates]
        return [candidates[1], candidates[0]]

    monkeypatch.setattr("mapping_memory.rag.rerank_chunks", rerank_chunks, raising=False)

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context(
        "Current question",
        settings=Settings(sqlite_path=sqlite_path),
        history=[
            AskHistoryMessage(role="user", content="Earlier question"),
            AskHistoryMessage(role="assistant", content="Earlier answer"),
        ],
    )

    assert [source.note_id for source in context.sources] == [second.id, first.id]
    assert captured == {
        "query": "user: Earlier question\nassistant: Earlier answer\nuser: Current question",
        "documents": ["complete first chunk", "complete second chunk"],
    }


def test_prepare_retrieval_context_preserves_chroma_order_when_reranking_fails(
    sqlite_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = create_note(sqlite_path, "First body", ai_title="First")
    second = create_note(sqlite_path, "Second body", ai_title="Second")
    _install_fakes(
        monkeypatch,
        [_hit(first.id, 0, "first chunk"), _hit(second.id, 0, "second chunk")],
        expected_query="user: question",
    )
    monkeypatch.setattr(
        "mapping_memory.rag.rerank_chunks",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("provider details")),
        raising=False,
    )

    from mapping_memory.rag import prepare_retrieval_context

    context = prepare_retrieval_context("question", settings=Settings(sqlite_path=sqlite_path))

    assert [source.note_id for source in context.sources] == [first.id, second.id]


def test_prepare_retrieval_context_rejects_blank_question(sqlite_path: Path) -> None:
    from mapping_memory.rag import prepare_retrieval_context

    with pytest.raises(ValueError, match="question must not be empty"):
        prepare_retrieval_context(" \n\t ", settings=Settings(sqlite_path=sqlite_path))


def _install_fakes(
    monkeypatch: pytest.MonkeyPatch,
    results: list[VectorSearchResult],
    *,
    query_errors: list[Exception] | None = None,
    expected_query: str = "user: source question",
) -> None:
    def embed_query(text: str, *, settings: Settings) -> list[float]:
        assert text == expected_query
        assert settings.sqlite_path
        return [0.1, 0.2, 0.3]

    FakeVectorStore.results = results
    FakeVectorStore.calls = []
    FakeVectorStore.query_errors = list(query_errors or [])
    monkeypatch.setattr(
        "mapping_memory.rag.chroma_index_ready", lambda settings: True, raising=False
    )
    monkeypatch.setattr("mapping_memory.rag.embed_query", embed_query, raising=False)
    monkeypatch.setattr(
        "mapping_memory.rag.rerank_chunks",
        lambda query, candidates, *, settings: list(candidates),
        raising=False,
    )
    monkeypatch.setattr("mapping_memory.rag.ChromaVectorStore", FakeVectorStore, raising=False)


def _hit(note_id: int, chunk_index: int | str, text: str) -> VectorSearchResult:
    return VectorSearchResult(
        id=f"note:{note_id}:chunk:{chunk_index}",
        text=text,
        metadata={"note_id": note_id, "chunk_index": chunk_index},
        distance=0.1,
    )
