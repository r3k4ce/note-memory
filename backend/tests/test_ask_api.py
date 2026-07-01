from types import SimpleNamespace
from typing import Any

from fastapi.testclient import TestClient
from pydantic import SecretStr

from mapping_memory.rag import RagContextChunk, RagRetrievalContext, RagSource
from mapping_memory.settings import Settings

FALLBACK = "I do not have this in the saved knowledge base."


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


def _ask_app(tmp_path, monkeypatch, *, retrieval_context: RagRetrievalContext, answer):
    from mapping_memory.main import create_app

    def prepare_retrieval_context(question: str, *, settings: Settings) -> RagRetrievalContext:
        assert question.strip()
        assert settings.sqlite_path
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
