import re
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, ClassVar

import pytest
from fastapi import HTTPException
from pydantic import SecretStr, ValidationError

from mapping_memory.ai import AnswerResponseError, GroundedAnswer, GroundedClaim
from mapping_memory.chat import create_chat_thread, get_chat_thread, list_chat_messages
from mapping_memory.db import init_db
from mapping_memory.memory import LOCAL_OWNER_ID
from mapping_memory.notes import create_category, create_note
from mapping_memory.rag import RagContextChunk, RagRetrievalContext, RagSource
from mapping_memory.schemas import AskRequest, AskResponse
from mapping_memory.settings import Settings
from mapping_memory.vector_store import VectorSearchResult

FALLBACK = "I do not have this in the saved notes."

AskEndpoint = Callable[[AskRequest], AskResponse]


class DirectAskResponse:
    def __init__(self, status_code: int, body: dict[str, Any]) -> None:
        self.status_code = status_code
        self._body = body
        self.text = str(body)

    def json(self) -> dict[str, Any]:
        return self._body


def _post_ask(ask_endpoint: AskEndpoint, payload: dict[str, Any]) -> DirectAskResponse:
    try:
        request = AskRequest.model_validate(payload)
        response = ask_endpoint(request)
    except ValidationError as error:
        return DirectAskResponse(422, {"detail": error.errors()})
    except HTTPException as error:
        return DirectAskResponse(error.status_code, {"detail": error.detail})

    return DirectAskResponse(200, response.model_dump(mode="json", exclude_none=True))


def test_ask_returns_fallback_when_retrieval_has_no_context(tmp_path, monkeypatch) -> None:
    calls: list[str] = []
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: calls.append("called") or "unexpected",
    )

    response = _post_ask(ask_endpoint, {"question": "What decision was saved?"})

    assert response.status_code == 200
    assert response.json() == {
        "answer": FALLBACK,
        "status": "no_evidence",
        "evidence_summary": {"source_count": 0, "snippet_count": 0, "match_types": []},
        "memory_updates": 0,
        "sources": [],
    }
    assert calls == []


def test_ask_returns_answer_with_source_metadata(tmp_path, monkeypatch) -> None:
    source = _source(note_id=7, title="Source recreation", date_added="2026-07-01T01:00:00Z")
    ask_endpoint = _ask_app(
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

    response = _post_ask(ask_endpoint, {"question": "When should we use it?"})

    assert response.status_code == 200
    assert response.json() == {
        "answer": "Use the recreated source only after QA. [1]",
        "status": "answered",
        "evidence_summary": {"source_count": 1, "snippet_count": 1, "match_types": ["semantic"]},
        "memory_updates": 0,
        "sources": [
            {
                "note_id": 7,
                "title": "Source recreation",
                "date_added": "2026-07-01T01:00:00Z",
                "snippets": [{"text": "text", "match_type": "semantic", "chunk_index": 0}],
            }
        ],
    }


def test_ask_uses_memory_as_untrusted_context_learns_and_persists_turn(
    tmp_path, monkeypatch
) -> None:
    from mapping_memory.ask import create_ask_router
    from mapping_memory.schemas import MemoryRecord

    source = _source(note_id=7, title="Source", date_added="2026-07-01T01:00:00Z")
    captured: dict[str, Any] = {}

    class FakeMemory:
        def search(self, query: str) -> list[MemoryRecord]:
            assert query == "What should we do?"
            return [MemoryRecord(id="one", content="Prefers concise answers.")]

        def learn(self, user_message: str, assistant_message: str) -> int:
            captured["learn"] = (user_message, assistant_message)
            return 2

    monkeypatch.setattr(
        "mapping_memory.ask.prepare_retrieval_context",
        lambda *_, **__: RagRetrievalContext(sources=(source,), formatted_context="context"),
    )
    monkeypatch.setattr(
        "mapping_memory.ask.generate_grounded_answer",
        lambda **kwargs: (
            captured.update(kwargs)
            or GroundedAnswer(
                status="answered",
                claims=[GroundedClaim(text="Use the saved checklist.", evidence_ids=["chunk-7"])],
            )
        ),
    )
    settings = Settings(
        sqlite_path=tmp_path / "ask.sqlite",
        groq_api_key=SecretStr("test-groq-key"),
        voyage_api_key=SecretStr("test-voyage-key"),
    )
    init_db(settings.sqlite_path)
    response = _post_ask(
        _ask_endpoint(create_ask_router(settings, memory_adapter=FakeMemory())),
        {"question": "What should we do?"},
    )

    assert response.json()["memory_updates"] == 2
    assert captured["memory_context"] == ["Prefers concise answers."]
    assert captured["learn"] == ("What should we do?", "Use the saved checklist. [1]")
    transcript_roles = [
        message.role for message in list_chat_messages(settings.sqlite_path, LOCAL_OWNER_ID)
    ]
    assert transcript_roles == [
        "user",
        "assistant",
    ]


def test_groq_only_ask_skips_memory_and_answers_from_local_evidence(tmp_path, monkeypatch) -> None:
    from mapping_memory.ask import create_ask_router

    source = _source(note_id=7, title="Local source", date_added="2026-07-01T01:00:00Z")
    memory_calls: list[str] = []

    class MemoryMustNotRun:
        def search(self, query: str) -> list[Any]:
            memory_calls.append("search")
            return []

        def learn(self, user_message: str, assistant_message: str) -> int:
            memory_calls.append("learn")
            return 0

    monkeypatch.setattr(
        "mapping_memory.ask.prepare_retrieval_context",
        lambda *_, **__: RagRetrievalContext(sources=(source,), formatted_context="local context"),
    )
    monkeypatch.setattr(
        "mapping_memory.ask.generate_grounded_answer",
        lambda **_: GroundedAnswer(
            status="answered",
            claims=[GroundedClaim(text="Use the local checklist.", evidence_ids=["chunk-7"])],
        ),
    )
    settings = Settings(
        sqlite_path=tmp_path / "ask.sqlite", groq_api_key=SecretStr("test-groq-key")
    )
    init_db(settings.sqlite_path)

    response = _post_ask(
        _ask_endpoint(create_ask_router(settings, memory_adapter=MemoryMustNotRun())),
        {"question": "What should we use?"},
    )

    assert response.status_code == 200
    assert response.json()["answer"] == "Use the local checklist. [1]"
    assert response.json()["memory_updates"] == 0
    assert memory_calls == []


def test_ask_persists_turn_to_requested_thread_without_copying_first_question_to_title(
    tmp_path, monkeypatch
) -> None:
    from mapping_memory.ask import create_ask_router

    class FakeMemory:
        def search(self, query: str) -> list[Any]:
            return []

        def learn(self, user_message: str, assistant_message: str) -> int:
            return 0

    source = _source(note_id=7, title="Source", date_added="2026-07-01T01:00:00Z")
    monkeypatch.setattr(
        "mapping_memory.ask.prepare_retrieval_context",
        lambda *_, **__: RagRetrievalContext(sources=(source,), formatted_context="context"),
    )
    monkeypatch.setattr(
        "mapping_memory.ask.generate_grounded_answer",
        lambda **_: GroundedAnswer(
            status="answered",
            claims=[GroundedClaim(text="Thread answer.", evidence_ids=["chunk-7"])],
        ),
    )
    settings = Settings(
        sqlite_path=tmp_path / "ask.sqlite", groq_api_key=SecretStr("test-groq-key")
    )
    init_db(settings.sqlite_path)
    thread = create_chat_thread(
        settings.sqlite_path,
        LOCAL_OWNER_ID,
        scope={"mode": "custom", "note_ids": [7]},
    )
    other_thread = create_chat_thread(settings.sqlite_path, LOCAL_OWNER_ID, title="Other")

    response = _post_ask(
        _ask_endpoint(create_ask_router(settings, memory_adapter=FakeMemory())),
        {"thread_id": thread.id, "question": "What should launch use?"},
    )

    assert response.status_code == 200
    thread_messages = list_chat_messages(settings.sqlite_path, LOCAL_OWNER_ID, thread.id)
    assert [message.content for message in thread_messages] == [
        "What should launch use?",
        "Thread answer. [1]",
    ]
    assert list_chat_messages(settings.sqlite_path, LOCAL_OWNER_ID, other_thread.id) == []
    updated_thread = get_chat_thread(settings.sqlite_path, LOCAL_OWNER_ID, thread.id)
    assert updated_thread is not None
    assert updated_thread.title == "Untitled chat"


def test_ask_rejects_missing_thread_before_retrieval(tmp_path, monkeypatch) -> None:
    calls: list[str] = []
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: calls.append("called") or "unexpected",
    )

    response = _post_ask(ask_endpoint, {"thread_id": 999, "question": "What?"})

    assert response.status_code == 404
    assert response.json() == {"detail": "Chat thread not found"}
    assert calls == []


def test_ask_learns_from_no_evidence_and_memory_failures_never_fail_answer(
    tmp_path, monkeypatch
) -> None:
    from mapping_memory.ask import create_ask_router

    class FailingMemory:
        def search(self, query: str) -> list[Any]:
            raise RuntimeError("provider detail must not leak")

        def learn(self, user_message: str, assistant_message: str) -> int:
            raise RuntimeError("provider detail must not leak")

    monkeypatch.setattr(
        "mapping_memory.ask.prepare_retrieval_context",
        lambda *_, **__: RagRetrievalContext(sources=(), formatted_context=""),
    )
    settings = Settings(
        sqlite_path=tmp_path / "ask.sqlite",
        groq_api_key=SecretStr("test-groq-key"),
        voyage_api_key=SecretStr("test-voyage-key"),
    )
    init_db(settings.sqlite_path)
    response = _post_ask(
        _ask_endpoint(create_ask_router(settings, memory_adapter=FailingMemory())),
        {"question": "My durable preference is concise answers."},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "no_evidence"
    assert response.json()["memory_updates"] == 0
    assert "provider detail" not in response.text


def test_ask_renders_validated_claim_citations_and_only_cited_source_chunks(
    tmp_path, monkeypatch
) -> None:
    first = RagSource(
        note_id=7,
        title="First source",
        date_added="2026-07-01T01:00:00Z",
        tags=(),
        chunks=(
            RagContextChunk("first-a", 0, "First cited chunk", 0.1),
            RagContextChunk("first-b", 1, "First uncited chunk", 0.2),
        ),
    )
    second = RagSource(
        note_id=8,
        title="Second source",
        date_added="2026-07-01T02:00:00Z",
        tags=(),
        chunks=(RagContextChunk("second-a", 0, "Second cited chunk", 0.1),),
    )
    answer = GroundedAnswer(
        status="answered",
        claims=[
            GroundedClaim(text="First claim.", evidence_ids=["first-a"]),
            GroundedClaim(text="Second claim.", evidence_ids=["second-a", "first-a"]),
        ],
    )
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(first, second), formatted_context="context"),
        answer=lambda **_: answer,
    )

    response = _post_ask(ask_endpoint, {"question": "What happened?"})

    assert response.status_code == 200
    assert response.json() == {
        "answer": "First claim. [1]\n\nSecond claim. [2] [1]",
        "status": "answered",
        "evidence_summary": {"source_count": 2, "snippet_count": 2, "match_types": ["semantic"]},
        "memory_updates": 0,
        "sources": [
            {
                "note_id": 7,
                "title": "First source",
                "date_added": "2026-07-01T01:00:00Z",
                "snippets": [
                    {"text": "First cited chunk", "match_type": "semantic", "chunk_index": 0}
                ],
            },
            {
                "note_id": 8,
                "title": "Second source",
                "date_added": "2026-07-01T02:00:00Z",
                "snippets": [
                    {"text": "Second cited chunk", "match_type": "semantic", "chunk_index": 0}
                ],
            },
        ],
    }


@pytest.mark.parametrize(
    "answer",
    [
        GroundedAnswer(status="answered", claims=[]),
        GroundedAnswer(
            status="answered", claims=[GroundedClaim(text="Claim.", evidence_ids=["missing"])]
        ),
        GroundedAnswer(
            status="answered",
            claims=[GroundedClaim(text="Claim.", evidence_ids=["chunk-7", "chunk-7"])],
        ),
        GroundedAnswer(
            status="answered", claims=[GroundedClaim(text="Claim [1].", evidence_ids=["chunk-7"])]
        ),
        GroundedAnswer(
            status="no_evidence", claims=[GroundedClaim(text="Claim.", evidence_ids=["chunk-7"])]
        ),
    ],
)
def test_ask_returns_no_evidence_for_invalid_grounded_output(tmp_path, monkeypatch, answer) -> None:
    source = _source(note_id=7, title="Source", date_added="2026-07-01T01:00:00Z")
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(source,), formatted_context="context"),
        answer=lambda **_: answer,
    )

    response = _post_ask(ask_endpoint, {"question": "What happened?"})

    assert response.status_code == 200
    assert response.json() == {
        "answer": FALLBACK,
        "status": "no_evidence",
        "evidence_summary": {"source_count": 0, "snippet_count": 0, "match_types": []},
        "memory_updates": 0,
        "sources": [],
    }


def test_ask_returns_no_evidence_for_unparseable_grounded_output(tmp_path, monkeypatch) -> None:
    source = _source(note_id=7, title="Source", date_added="2026-07-01T01:00:00Z")

    def answer(**_: Any) -> GroundedAnswer:
        raise AnswerResponseError("invalid model output")

    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(source,), formatted_context="context"),
        answer=answer,
    )

    response = _post_ask(ask_endpoint, {"question": "What happened?"})

    assert response.status_code == 200
    assert response.json()["status"] == "no_evidence"


def test_ask_passes_category_scope_to_retrieval(tmp_path, monkeypatch) -> None:
    captured: dict[str, Any] = {}
    source = _source(note_id=7, title="Scoped source", date_added="2026-07-01T01:00:00Z")
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(source,), formatted_context="context"),
        answer=lambda **_: "Scoped answer.",
        capture=captured,
    )

    category = create_category(tmp_path / "ask.sqlite", "Projects")
    response = _post_ask(
        ask_endpoint,
        {"question": "What is scoped?", "category_id": category.id},
    )

    assert response.status_code == 200
    assert captured["category_scope"].category_id == category.id
    assert captured["category_scope"].uncategorized is False


def test_ask_accepts_note_ids(tmp_path, monkeypatch) -> None:
    captured: dict[str, Any] = {}
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
        capture=captured,
    )

    response = _post_ask(ask_endpoint, {"question": "What is scoped?", "note_ids": [1, 2, 3]})

    assert response.status_code == 200
    assert captured["note_ids"] == [1, 2, 3]


def test_ask_empty_note_ids_returns_fallback_and_no_sources(tmp_path, monkeypatch) -> None:
    answer_calls: list[dict[str, Any]] = []
    ask_endpoint = _ask_app_with_real_retrieval(
        tmp_path,
        monkeypatch,
        vector_results=[],
        answer=lambda **kwargs: answer_calls.append(kwargs) or "unexpected",
    )

    response = _post_ask(ask_endpoint, {"question": "What is scoped?", "note_ids": []})

    assert response.status_code == 200
    assert response.json() == {
        "answer": FALLBACK,
        "status": "no_evidence",
        "evidence_summary": {"source_count": 0, "snippet_count": 0, "match_types": []},
        "memory_updates": 0,
        "sources": [],
    }
    assert answer_calls == []
    assert FakeAskVectorStore.calls == []


def test_ask_selected_note_ids_returns_only_selected_sources(tmp_path, monkeypatch) -> None:
    sqlite_path = _init_ask_path(tmp_path)
    selected = create_note(sqlite_path, "Selected note body", ai_title="Selected note")
    unselected = create_note(sqlite_path, "Unselected note body", ai_title="Unselected note")
    captured: dict[str, Any] = {}
    ask_endpoint = _ask_app_with_real_retrieval(
        tmp_path,
        monkeypatch,
        init_db_first=False,
        vector_results=[
            _vector_hit(unselected.id, 0, "unselected chunk must not reach the model"),
            _vector_hit(selected.id, 0, "selected chunk"),
        ],
        answer=lambda **kwargs: captured.update(kwargs) or "Selected answer.",
    )

    response = _post_ask(
        ask_endpoint,
        {"question": "What is scoped?", "note_ids": [selected.id]},
    )

    assert response.status_code == 200
    assert response.json()["answer"] == "Selected answer. [1]"
    assert response.json()["sources"] == [
        {
            "note_id": selected.id,
            "title": "Selected note",
            "date_added": selected.date_added,
            "snippets": [
                {"text": "selected chunk", "match_type": "semantic", "chunk_index": 0},
            ],
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
    ask_endpoint = _ask_app_with_real_retrieval(
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

    response = _post_ask(
        ask_endpoint,
        {
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
            "snippets": [
                {"text": "matching chunk", "match_type": "semantic", "chunk_index": 0},
            ],
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
    ask_endpoint = _ask_app_with_real_retrieval(
        tmp_path,
        monkeypatch,
        init_db_first=False,
        vector_results=[
            _vector_hit(first.id, 0, "first chunk"),
            _vector_hit(second.id, 0, "second chunk"),
        ],
        answer=lambda **_: "Unscoped answer.",
    )

    response = _post_ask(ask_endpoint, {"question": "What is scoped?"})

    assert response.status_code == 200
    assert response.json()["sources"] == [
        {
            "note_id": first.id,
            "title": "First note",
            "date_added": first.date_added,
            "snippets": [{"text": "first chunk", "match_type": "semantic", "chunk_index": 0}],
        },
        {
            "note_id": second.id,
            "title": "Second note",
            "date_added": second.date_added,
            "snippets": [{"text": "second chunk", "match_type": "semantic", "chunk_index": 0}],
        },
    ]
    assert FakeAskVectorStore.calls == [{"embedding": [0.1, 0.2, 0.3], "limit": 20, "where": None}]


def test_ask_rejects_invalid_note_ids(tmp_path, monkeypatch) -> None:
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
    )

    response = _post_ask(ask_endpoint, {"question": "What is scoped?", "note_ids": [0]})

    assert response.status_code == 422


def test_ask_rejects_more_than_500_note_ids(tmp_path, monkeypatch) -> None:
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
    )

    response = _post_ask(
        ask_endpoint,
        {"question": "What is scoped?", "note_ids": list(range(1, 502))},
    )

    assert response.status_code == 422


def test_ask_rejects_missing_category_scope(tmp_path, monkeypatch) -> None:
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
    )

    response = _post_ask(ask_endpoint, {"question": "What?", "category_id": 999999})

    assert response.status_code == 422
    assert response.json() == {"detail": "Category not found"}


def test_ask_rejects_conflicting_category_scopes(tmp_path, monkeypatch) -> None:
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
    )

    response = _post_ask(
        ask_endpoint,
        {"question": "What?", "category_id": 1, "uncategorized": True},
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "category_id and uncategorized cannot both be set"}


def test_ask_rejects_empty_question(tmp_path, monkeypatch) -> None:
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: "unexpected",
    )

    response = _post_ask(ask_endpoint, {"question": " \n\t "})

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

    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(
            sources=(source,),
            formatted_context=retrieved_context,
        ),
        answer=answer,
    )

    response = _post_ask(ask_endpoint, {"question": "What is relevant?"})

    assert response.status_code == 200
    assert captured["question"] == "What is relevant?"
    assert response.text.find(forbidden_full_database_text) == -1


def test_ask_sources_still_come_only_from_notes(tmp_path, monkeypatch) -> None:
    source = _source(note_id=9, title="Retrieved card", date_added="2026-07-01T05:00:00Z")
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(
            sources=(source,), formatted_context="retrieved context"
        ),
        answer=lambda **_: "Grounded answer.",
    )

    response = _post_ask(ask_endpoint, {"question": "What source should be cited?"})

    assert response.status_code == 200
    assert response.json()["sources"] == [
        {
            "note_id": 9,
            "title": "Retrieved card",
            "date_added": "2026-07-01T05:00:00Z",
            "snippets": [{"text": "text", "match_type": "semantic", "chunk_index": 0}],
        }
    ]


def test_ask_without_note_context_cannot_produce_answer(tmp_path, monkeypatch) -> None:
    calls: list[str] = []
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(), formatted_context=""),
        answer=lambda **_: calls.append("called") or "history-only answer",
    )

    response = _post_ask(ask_endpoint, {"question": "What was the decision?"})

    assert response.status_code == 200
    assert response.json() == {
        "answer": FALLBACK,
        "status": "no_evidence",
        "evidence_summary": {"source_count": 0, "snippet_count": 0, "match_types": []},
        "memory_updates": 0,
        "sources": [],
    }
    assert calls == []


def test_ask_returns_empty_sources_when_model_returns_fallback(tmp_path, monkeypatch) -> None:
    source = _source(note_id=4, title="Unhelpful source", date_added="2026-07-01T03:00:00Z")
    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(source,), formatted_context="context"),
        answer=lambda **_: FALLBACK,
    )

    response = _post_ask(ask_endpoint, {"question": "What is missing?"})

    assert response.status_code == 200
    assert response.json() == {
        "answer": FALLBACK,
        "status": "no_evidence",
        "evidence_summary": {"source_count": 0, "snippet_count": 0, "match_types": []},
        "memory_updates": 0,
        "sources": [],
    }


def test_ask_real_retrieval_reports_exact_evidence_when_semantic_misses(
    tmp_path, monkeypatch
) -> None:
    sqlite_path = _init_ask_path(tmp_path)
    note = create_note(
        sqlite_path,
        "The quiet launch phrase is maple-glider.",
        ai_title="Launch phrase",
        tags=["release"],
    )
    captured: dict[str, Any] = {}
    ask_endpoint = _ask_app_with_real_retrieval(
        tmp_path,
        monkeypatch,
        init_db_first=False,
        vector_results=[],
        answer=lambda **kwargs: captured.update(kwargs) or "Bun found maple-glider.",
        expected_query="maple-glider",
    )

    response = _post_ask(ask_endpoint, {"question": "maple-glider"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "answered"
    assert body["evidence_summary"] == {
        "source_count": 1,
        "snippet_count": 1,
        "match_types": ["exact"],
    }
    assert body["sources"] == [
        {
            "note_id": note.id,
            "title": "Launch phrase",
            "date_added": note.date_added,
            "snippets": [
                {
                    "text": "The quiet launch phrase is maple-glider.",
                    "match_type": "exact",
                    "chunk_index": 0,
                    "chunk_type": "full",
                    "source_start": 0,
                    "source_end": 40,
                }
            ],
        }
    ]
    assert "maple-glider" in captured["context"]


def test_ask_real_retrieval_respects_selected_scope_for_local_evidence(
    tmp_path, monkeypatch
) -> None:
    sqlite_path = _init_ask_path(tmp_path)
    selected = create_note(sqlite_path, "Selected note body.", ai_title="Selected")
    create_note(sqlite_path, "Forbidden exact phrase.", ai_title="Unselected")
    ask_endpoint = _ask_app_with_real_retrieval(
        tmp_path,
        monkeypatch,
        init_db_first=False,
        vector_results=[],
        answer=lambda **_: "Selected answer.",
        expected_query="Forbidden exact phrase",
    )

    response = _post_ask(
        ask_endpoint,
        {"question": "Forbidden exact phrase", "note_ids": [selected.id]},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "answered"
    assert [source["note_id"] for source in response.json()["sources"]] == [selected.id]


def test_ask_returns_sanitized_503_when_answer_generation_fails(tmp_path, monkeypatch) -> None:
    source = _source(note_id=5, title="Answer source", date_added="2026-07-01T04:00:00Z")

    def answer(**_: Any) -> str:
        raise RuntimeError("provider failure with secret-ish details")

    ask_endpoint = _ask_app(
        tmp_path,
        monkeypatch,
        retrieval_context=RagRetrievalContext(sources=(source,), formatted_context="context"),
        answer=answer,
    )

    response = _post_ask(ask_endpoint, {"question": "What failed?"})

    assert response.status_code == 503
    assert response.json() == {"detail": "Ask endpoint is unavailable"}
    assert "provider failure" not in response.text


def test_generate_grounded_answer_uses_only_supplied_context_and_question() -> None:
    from mapping_memory.ai import ANSWER_SYSTEM_PROMPT, generate_grounded_answer

    fake_client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))

    answer = generate_grounded_answer(
        "What should we do?",
        context="Card title: Saved card\nRelevant text:\nUse saved decision.",
        settings=Settings(groq_api_key=None, groq_chat_model="llama-3.3-70b-versatile"),
        client=fake_client,
    )

    assert answer == GroundedAnswer(
        status="answered",
        claims=[GroundedClaim(text="Use saved decision.", evidence_ids=["saved-decision"])],
    )
    call = fake_client.chat.completions.calls[0]
    assert call["model"] == "llama-3.3-70b-versatile"
    assert call["response_format"]["type"] == "json_schema"
    assert call["response_format"]["json_schema"]["schema"] == GroundedAnswer.model_json_schema()
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
        message = SimpleNamespace(
            content=GroundedAnswer(
                status="answered",
                claims=[GroundedClaim(text="Use saved decision.", evidence_ids=["saved-decision"])],
            ).model_dump_json(),
            refusal=None,
        )
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
    from mapping_memory.ask import create_ask_router

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

    def generate_grounded_answer(**kwargs: Any):
        result = answer(**kwargs)
        if not isinstance(result, str):
            return result
        if result == FALLBACK:
            return GroundedAnswer(status="no_evidence", claims=[])
        evidence_ids = [
            chunk.chunk_id for source in retrieval_context.sources for chunk in source.chunks
        ]
        return GroundedAnswer(
            status="answered",
            claims=[GroundedClaim(text=result, evidence_ids=evidence_ids)],
        )

    monkeypatch.setattr(
        "mapping_memory.ask.generate_grounded_answer", generate_grounded_answer, raising=False
    )
    settings = Settings(
        sqlite_path=tmp_path / "ask.sqlite",
        groq_api_key=SecretStr("test-groq-key"),
    )
    init_db(settings.sqlite_path)
    return _ask_endpoint(create_ask_router(settings))


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
    expected_query: str = "What is scoped?",
):
    from mapping_memory.ask import create_ask_router

    sqlite_path = tmp_path / "ask.sqlite"
    if init_db_first:
        init_db(sqlite_path)

    def embed_query(text: str, *, settings: Settings) -> list[float]:
        assert text == expected_query
        assert settings.sqlite_path == sqlite_path
        return [0.1, 0.2, 0.3]

    FakeAskVectorStore.results = vector_results
    FakeAskVectorStore.calls = []
    monkeypatch.setattr(
        "mapping_memory.rag.chroma_index_ready", lambda settings: True, raising=False
    )
    monkeypatch.setattr("mapping_memory.rag.embed_query", embed_query, raising=False)
    monkeypatch.setattr(
        "mapping_memory.rag.rerank_chunks",
        lambda query, candidates, *, settings: list(candidates),
        raising=False,
    )
    monkeypatch.setattr("mapping_memory.rag.ChromaVectorStore", FakeAskVectorStore, raising=False)

    def generate_grounded_answer(**kwargs: Any):
        result = answer(**kwargs)
        if not isinstance(result, str):
            return result
        if result == FALLBACK:
            return GroundedAnswer(status="no_evidence", claims=[])
        evidence_ids = re.findall(r"^Evidence ID: (.+)$", kwargs["context"], flags=re.MULTILINE)
        return GroundedAnswer(
            status="answered",
            claims=[GroundedClaim(text=result, evidence_ids=evidence_ids)],
        )

    monkeypatch.setattr(
        "mapping_memory.ask.generate_grounded_answer", generate_grounded_answer, raising=False
    )
    return _ask_endpoint(
        create_ask_router(
            Settings(
                sqlite_path=sqlite_path,
                groq_api_key=SecretStr("test-groq-key"),
                voyage_api_key=SecretStr("test-voyage-key"),
            )
        )
    )


def _ask_endpoint(router) -> AskEndpoint:
    for route in router.routes:
        if getattr(route, "path", None) == "/ask":
            return route.endpoint

    raise AssertionError("Ask route was not registered")


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
