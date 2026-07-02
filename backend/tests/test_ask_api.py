from pathlib import Path
from types import SimpleNamespace
from typing import Any, ClassVar

from fastapi.testclient import TestClient
from pydantic import SecretStr

from mapping_memory.db import init_db
from mapping_memory.notes import create_category, create_note
from mapping_memory.rag import RagContextChunk, RagRetrievalContext, RagSource
from mapping_memory.settings import Settings
from mapping_memory.vector_store import VectorSearchResult

FALLBACK = "I do not have this in the saved notes."


def test_ask_returns_fallback_when_retrieval_has_no_context(tmp_path, monkeypatch) -> None:
    calls: list[str] = []
    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: calls.append("called") or "unexpected",
    )

    with TestClient(app) as client:
        response = client.post("/ask", json={"question": "What decision was saved?"})

    assert response.status_code == 200
    assert response.json() == {"answer": FALLBACK, "sources": []}
    assert calls == []


def test_ask_returns_answer_with_source_metadata(tmp_path, monkeypatch) -> None:
    source = _source(note_id=7, title="Source recreation", date_added="2026-07-01T01:00:00Z")
    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(
            sources=(source,),
            formatted_context=(
                "Card title: Source recreation\n"
                "Date added: 2026-07-01T01:00:00Z\n"
                "Relevant text:\nUse recreated source only after QA."
            ),
        ),
        answer=lambda **_: "Use the recreated source only after QA.",
    )

    with TestClient(app) as client:
        response = client.post("/ask", json={"question": "When should we use it?"})

    assert response.status_code == 200
    assert response.json() == {
        "answer": "Use the recreated source only after QA.",
        "sources": [
            {
                "note_id": 7,
                "title": "Source recreation",
                "date_added": "2026-07-01T01:00:00Z",
            }
        ],
    }


def test_ask_passes_category_scope_to_retrieval(tmp_path, monkeypatch) -> None:
    captured: dict[str, Any] = {}
    source = _source(note_id=7, title="Scoped source", date_added="2026-07-01T01:00:00Z")
    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(source,), formatted_context="context"),
        answer=lambda **_: "Scoped answer.",
        capture=captured,
    )

    with TestClient(app) as client:
        category = client.post("/categories", json={"name": "Projects"}).json()
        response = client.post(
            "/ask",
            json={"question": "What is scoped?", "category_id": category["id"]},
        )

    assert response.status_code == 200
    assert captured["category_scope"].category_id == category["id"]
    assert captured["category_scope"].uncategorized is False


def test_ask_accepts_note_ids(tmp_path, monkeypatch) -> None:
    captured: dict[str, Any] = {}
    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
        capture=captured,
    )

    with TestClient(app) as client:
        response = client.post(
            "/ask",
            json={"question": "What is scoped?", "note_ids": [1, 2, 3]},
        )

    assert response.status_code == 200
    assert captured["note_ids"] == [1, 2, 3]


def test_ask_empty_note_ids_returns_fallback_and_no_sources(tmp_path, monkeypatch) -> None:
    answer_calls: list[dict[str, Any]] = []
    app = _ask_app_with_real_retrieval(
        tmp_path,
        monkeypatch,
        vector_results=[],
        answer=lambda **kwargs: answer_calls.append(kwargs) or "unexpected",
    )

    with TestClient(app) as client:
        response = client.post(
            "/ask",
            json={"question": "What is scoped?", "note_ids": []},
        )

    assert response.status_code == 200
    assert response.json() == {"answer": FALLBACK, "sources": []}
    assert answer_calls == []
    assert FakeAskVectorStore.calls == []


def test_ask_selected_note_ids_returns_only_selected_sources(tmp_path, monkeypatch) -> None:
    sqlite_path = _init_ask_path(tmp_path)
    selected = create_note(sqlite_path, "Selected note body", ai_title="Selected note")
    unselected = create_note(sqlite_path, "Unselected note body", ai_title="Unselected note")
    captured: dict[str, Any] = {}
    app = _ask_app_with_real_retrieval(
        tmp_path,
        monkeypatch,
        init_db_first=False,
        vector_results=[
            _vector_hit(unselected.id, 0, "unselected chunk must not reach the model"),
            _vector_hit(selected.id, 0, "selected chunk"),
        ],
        answer=lambda **kwargs: captured.update(kwargs) or "Selected answer.",
    )

    with TestClient(app) as client:
        response = client.post(
            "/ask",
            json={"question": "What is scoped?", "note_ids": [selected.id]},
        )

    assert response.status_code == 200
    assert response.json()["answer"] == "Selected answer."
    assert response.json()["sources"] == [
        {
            "note_id": selected.id,
            "title": "Selected note",
            "date_added": selected.date_added,
        }
    ]
    assert "selected chunk" in captured["context"]
    assert "unselected chunk must not reach the model" not in captured["context"]
    assert FakeAskVectorStore.calls == [
        {
            "embedding": [0.1, 0.2, 0.3],
            "limit": 20,
            "where": {"note_id": {"$in": [selected.id]}},
        }
    ]


def test_ask_category_id_and_note_ids_uses_and_scope(tmp_path, monkeypatch) -> None:
    sqlite_path = _init_ask_path(tmp_path)
    category = create_category(sqlite_path, "Projects")
    matching = create_note(
        sqlite_path, "Matching note body", ai_title="Matching note", category_id=category.id
    )
    selected_wrong_category = create_note(
        sqlite_path, "Wrong category body", ai_title="Wrong category"
    )
    unselected_same_category = create_note(
        sqlite_path,
        "Unselected same category body",
        ai_title="Unselected same category",
        category_id=category.id,
    )
    app = _ask_app_with_real_retrieval(
        tmp_path,
        monkeypatch,
        init_db_first=False,
        vector_results=[
            _vector_hit(selected_wrong_category.id, 0, "wrong category chunk"),
            _vector_hit(unselected_same_category.id, 0, "unselected category chunk"),
            _vector_hit(matching.id, 0, "matching chunk"),
        ],
        answer=lambda **_: "Matching answer.",
    )

    with TestClient(app) as client:
        response = client.post(
            "/ask",
            json={
                "question": "What is scoped?",
                "category_id": category.id,
                "note_ids": [matching.id, selected_wrong_category.id],
            },
        )

    assert response.status_code == 200
    assert response.json()["sources"] == [
        {
            "note_id": matching.id,
            "title": "Matching note",
            "date_added": matching.date_added,
        }
    ]
    assert FakeAskVectorStore.calls == [
        {"updated_chunks": [(unselected_same_category.id, 0), (matching.id, 0)]},
        {
            "embedding": [0.1, 0.2, 0.3],
            "limit": 20,
            "where": {
                "$and": [
                    {"category_scope": f"category:{category.id}"},
                    {"note_id": {"$in": [matching.id, selected_wrong_category.id]}},
                ]
            },
        },
    ]


def test_ask_without_note_ids_keeps_existing_unscoped_behavior(tmp_path, monkeypatch) -> None:
    sqlite_path = _init_ask_path(tmp_path)
    first = create_note(sqlite_path, "First note body", ai_title="First note")
    second = create_note(sqlite_path, "Second note body", ai_title="Second note")
    app = _ask_app_with_real_retrieval(
        tmp_path,
        monkeypatch,
        init_db_first=False,
        vector_results=[
            _vector_hit(first.id, 0, "first chunk"),
            _vector_hit(second.id, 0, "second chunk"),
        ],
        answer=lambda **_: "Unscoped answer.",
    )

    with TestClient(app) as client:
        response = client.post("/ask", json={"question": "What is scoped?"})

    assert response.status_code == 200
    assert response.json()["sources"] == [
        {"note_id": first.id, "title": "First note", "date_added": first.date_added},
        {"note_id": second.id, "title": "Second note", "date_added": second.date_added},
    ]
    assert FakeAskVectorStore.calls == [{"embedding": [0.1, 0.2, 0.3], "limit": 20, "where": None}]


def test_ask_rejects_invalid_note_ids(tmp_path, monkeypatch) -> None:
    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
    )

    with TestClient(app) as client:
        response = client.post(
            "/ask",
            json={"question": "What is scoped?", "note_ids": [0]},
        )

    assert response.status_code == 422


def test_ask_rejects_more_than_500_note_ids(tmp_path, monkeypatch) -> None:
    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
    )

    with TestClient(app) as client:
        response = client.post(
            "/ask",
            json={"question": "What is scoped?", "note_ids": list(range(1, 502))},
        )

    assert response.status_code == 422


def test_ask_rejects_missing_category_scope(tmp_path, monkeypatch) -> None:
    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
    )

    with TestClient(app) as client:
        response = client.post("/ask", json={"question": "What?", "category_id": 999999})

    assert response.status_code == 422
    assert response.json() == {"detail": "Category not found"}


def test_ask_rejects_conflicting_category_scopes(tmp_path, monkeypatch) -> None:
    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
    )

    with TestClient(app) as client:
        response = client.post(
            "/ask",
            json={"question": "What?", "category_id": 1, "uncategorized": True},
        )

    assert response.status_code == 422
    assert response.json() == {"detail": "category_id and uncategorized cannot both be set"}


def test_ask_rejects_empty_question(tmp_path, monkeypatch) -> None:
    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
    )

    with TestClient(app) as client:
        response = client.post("/ask", json={"question": " \n\t "})

    assert response.status_code == 422


def test_ask_sends_only_retrieved_context_to_answer_model(tmp_path, monkeypatch) -> None:
    forbidden_full_database_text = "full database text must not be sent"
    captured: dict[str, Any] = {}
    source = _source(note_id=3, title="Chunk source", date_added="2026-07-01T02:00:00Z")
    retrieved_context = "Card title: Chunk source\nRelevant text:\nOnly this chunk is relevant."

    def answer(**kwargs: Any) -> str:
        captured.update(kwargs)
        assert forbidden_full_database_text not in kwargs["context"]
        assert kwargs["context"] == retrieved_context
        return "Only this chunk is relevant."

    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(
            sources=(source,),
            formatted_context=retrieved_context,
        ),
        answer=answer,
    )

    with TestClient(app) as client:
        response = client.post("/ask", json={"question": "What is relevant?"})

    assert response.status_code == 200
    assert captured["question"] == "What is relevant?"
    assert response.text.find(forbidden_full_database_text) == -1


def test_ask_returns_empty_sources_when_model_returns_fallback(tmp_path, monkeypatch) -> None:
    source = _source(note_id=4, title="Unhelpful source", date_added="2026-07-01T03:00:00Z")
    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(source,), formatted_context="context"),
        answer=lambda **_: FALLBACK,
    )

    with TestClient(app) as client:
        response = client.post("/ask", json={"question": "What is missing?"})

    assert response.status_code == 200
    assert response.json() == {"answer": FALLBACK, "sources": []}


def test_ask_returns_sanitized_503_when_answer_generation_fails(tmp_path, monkeypatch) -> None:
    source = _source(note_id=5, title="Answer source", date_added="2026-07-01T04:00:00Z")

    def answer(**_: Any) -> str:
        raise RuntimeError("provider failure with secret-ish details")

    app = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(source,), formatted_context="context"),
        answer=answer,
    )

    with TestClient(app) as client:
        response = client.post("/ask", json={"question": "What failed?"})

    assert response.status_code == 503
    assert response.json() == {"detail": "Ask endpoint is unavailable"}
    assert "provider failure" not in response.text


def test_generate_grounded_answer_uses_only_supplied_context_and_question() -> None:
    from mapping_memory.ai import ANSWER_SYSTEM_PROMPT, generate_grounded_answer

    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))

    answer = generate_grounded_answer(
        "What should we do?",
        context="Card title: Saved card\nRelevant text:\nUse saved decision.",
        settings=Settings(openai_api_key=None, openai_organizer_model="test-model"),
        client=fake_client,
    )

    assert answer == "Use saved decision."
    call = fake_client.chat.completions.calls[0]
    assert call["model"] == "test-model"
    assert call["messages"][0] == {"role": "system", "content": ANSWER_SYSTEM_PROMPT}
    user_message = call["messages"][1]["content"]
    assert "Card title: Saved card" in user_message
    assert "What should we do?" in user_message
    assert "full database" not in user_message


class FakeCompletions:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        message = SimpleNamespace(content="Use saved decision.")
        choice = SimpleNamespace(message=message)
        return SimpleNamespace(choices=[choice])


class FakeAskVectorStore:
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


def _ask_app(
    tmp_path,
    monkeypatch,
    *,
    retrieval_context: RagRetrievalContext,
    answer,
    capture: dict[str, Any] | None = None,
):
    from mapping_memory.main import create_app

    def prepare_retrieval_context(
        question: str,
        *,
        settings: Settings,
        category_scope=None,
        note_ids=None,
    ) -> RagRetrievalContext:
        assert question.strip()
        assert settings.sqlite_path
        if capture is not None:
            capture["category_scope"] = category_scope
            capture["note_ids"] = note_ids
        return retrieval_context

    monkeypatch.setattr(
        "mapping_memory.ask.prepare_retrieval_context",
        prepare_retrieval_context,
        raising=False,
    )
    monkeypatch.setattr("mapping_memory.ask.generate_grounded_answer", answer, raising=False)
    return create_app(
        Settings(sqlite_path=tmp_path / "ask.sqlite", openai_api_key=SecretStr("test-key"))
    )


def _init_ask_path(tmp_path: Path) -> Path:
    sqlite_path = tmp_path / "ask.sqlite"
    init_db(sqlite_path)
    return sqlite_path


def _ask_app_with_real_retrieval(
    tmp_path,
    monkeypatch,
    *,
    vector_results: list[VectorSearchResult],
    answer,
    init_db_first: bool = True,
):
    from mapping_memory.main import create_app

    sqlite_path = tmp_path / "ask.sqlite"
    if init_db_first:
        init_db(sqlite_path)

    def embed_texts(texts: list[str], *, settings: Settings) -> list[list[float]]:
        assert texts == ["What is scoped?"]
        assert settings.sqlite_path == sqlite_path
        return [[0.1, 0.2, 0.3]]

    FakeAskVectorStore.results = vector_results
    FakeAskVectorStore.calls = []
    monkeypatch.setattr("mapping_memory.rag.embed_texts", embed_texts, raising=False)
    monkeypatch.setattr("mapping_memory.rag.ChromaVectorStore", FakeAskVectorStore, raising=False)
    monkeypatch.setattr("mapping_memory.ask.generate_grounded_answer", answer, raising=False)
    return create_app(Settings(sqlite_path=sqlite_path, openai_api_key=SecretStr("test-key")))


def _source(note_id: int, title: str, date_added: str) -> RagSource:
    return RagSource(
        note_id=note_id,
        title=title,
        date_added=date_added,
        tags=(),
        chunks=(
            RagContextChunk(chunk_id=f"chunk-{note_id}", chunk_index=0, text="text", distance=0.1),
        ),
    )


def _vector_hit(note_id: int, chunk_index: int, text: str) -> VectorSearchResult:
    return VectorSearchResult(
        id=f"note:{note_id}:chunk:{chunk_index}",
        text=text,
        metadata={"note_id": note_id, "chunk_index": chunk_index},
        distance=0.1,
    )
