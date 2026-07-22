from pathlib import Path

from mapping_memory.chat import (
    GenerationJobRead,
    complete_generation_job,
    create_chat_thread,
    create_generation_turn,
    fail_generation_job,
    mark_generation_job_running,
    upsert_thread_summary,
)
from mapping_memory.db import init_db
from mapping_memory.schemas import AskEvidenceSummary, AskResponse


def _response(answer: str) -> AskResponse:
    return AskResponse(
        answer=answer,
        status="answered",
        evidence_summary=AskEvidenceSummary(source_count=0, snippet_count=0, match_types=[]),
        sources=[],
    )


def _complete(
    sqlite_path: Path, user_id: str, question: str, *, thread_id: int
) -> GenerationJobRead:
    job = create_generation_turn(sqlite_path, user_id, question, thread_id=thread_id)
    assert mark_generation_job_running(sqlite_path, user_id, job.id) is not None
    assert complete_generation_job(sqlite_path, user_id, job.id, _response(f"Answer: {question}"))
    return job


def test_loads_owned_turn_context_in_model_order(tmp_path: Path) -> None:
    from mapping_memory.assistant_context import load_assistant_context

    sqlite_path = tmp_path / "context.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(
        sqlite_path, "local-owner", scope={"mode": "custom", "note_ids": [7, 3]}
    )
    first = _complete(sqlite_path, "local-owner", "First question", thread_id=thread.id)
    _complete(sqlite_path, "local-owner", "Second question", thread_id=thread.id)
    current = create_generation_turn(
        sqlite_path, "local-owner", "Current question", thread_id=thread.id
    )
    upsert_thread_summary(
        sqlite_path, "local-owner", thread.id, "Earlier background", first.assistant_message_id
    )

    class Memory:
        def search(self, query: str) -> list[object]:
            assert query == "Current question"
            return [type("Memory", (), {"id": "memory-1", "content": "Prefers brief replies."})()]

    context = load_assistant_context(
        sqlite_path,
        current.id,
        tools=[{"type": "function", "function": {"name": "lookup"}}],
        memory_client=Memory(),
    )

    assert context is not None
    assert context.runtime.generation_job_id == current.id
    assert context.scope.mode == "custom"
    assert context.scope.note_ids == (7, 3)
    assert context.summary.content == "Earlier background"
    assert context.summary.is_evidence is False
    assert [(memory.id, memory.content, memory.is_evidence) for memory in context.memories] == [
        ("memory-1", "Prefers brief replies.", False)
    ]
    assert [(message.role, message.content) for message in context.recent_messages] == [
        ("user", "Second question"),
        ("assistant", "Answer: Second question"),
    ]
    assert context.current_message.content == "Current question"
    assert context.tools == ({"type": "function", "function": {"name": "lookup"}},)


def test_retains_failed_turn_user_but_excludes_failed_assistant_and_unowned_rows(
    tmp_path: Path,
) -> None:
    from mapping_memory.assistant_context import load_assistant_context

    sqlite_path = tmp_path / "context.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(sqlite_path, "local-owner")
    failed = create_generation_turn(
        sqlite_path, "local-owner", "Keep this user input", thread_id=thread.id
    )
    assert mark_generation_job_running(sqlite_path, "local-owner", failed.id)
    assert fail_generation_job(
        sqlite_path, "local-owner", failed.id, "failed", "provider", "Provider failed"
    )
    current = create_generation_turn(sqlite_path, "local-owner", "Current", thread_id=thread.id)
    other_thread = create_chat_thread(sqlite_path, "other-owner")
    _complete(sqlite_path, "other-owner", "Other owner", thread_id=other_thread.id)

    context = load_assistant_context(sqlite_path, current.id, tools=[])

    assert context is not None
    assert [(message.role, message.content) for message in context.recent_messages] == [
        ("user", "Keep this user input"),
    ]
    assert load_assistant_context(sqlite_path, current.id, tools=[], user_id="other-owner") is None


def test_older_job_excludes_future_transcript_and_summary(tmp_path: Path) -> None:
    from mapping_memory.assistant_context import load_assistant_context

    sqlite_path = tmp_path / "context.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(sqlite_path, "local-owner")
    older = create_generation_turn(
        sqlite_path, "local-owner", "Older question", thread_id=thread.id
    )
    later = _complete(sqlite_path, "local-owner", "Later question", thread_id=thread.id)
    upsert_thread_summary(
        sqlite_path,
        "local-owner",
        thread.id,
        "Future summary",
        later.assistant_message_id,
    )

    context = load_assistant_context(sqlite_path, older.id, tools=[])

    assert context is not None
    assert context.summary.content is None
    assert context.recent_messages == ()


def test_empty_summary_memory_failure_and_caps(tmp_path: Path) -> None:
    from mapping_memory.assistant_context import (
        CURRENT_MESSAGE_MAX_CHARS,
        RECENT_MESSAGE_MAX_CHARS,
        SUMMARY_MAX_CHARS,
        load_assistant_context,
    )

    sqlite_path = tmp_path / "context.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(sqlite_path, "local-owner")
    first = _complete(sqlite_path, "local-owner", "question 0" + "x" * 2_000, thread_id=thread.id)
    for index in range(1, 12):
        _complete(
            sqlite_path, "local-owner", f"question {index}" + "x" * 2_000, thread_id=thread.id
        )
    current = create_generation_turn(sqlite_path, "local-owner", "q" * 5_000, thread_id=thread.id)
    upsert_thread_summary(
        sqlite_path,
        "local-owner",
        thread.id,
        "s" * 5_000,
        first.assistant_message_id,
    )

    class FailingMemory:
        def search(self, query: str) -> list[object]:
            raise RuntimeError("private provider details")

    context = load_assistant_context(
        sqlite_path,
        current.id,
        tools=[{"type": "function", "function": {"name": f"tool-{index}"}} for index in range(20)],
        memory_client=FailingMemory(),
    )

    assert context is not None
    assert context.summary.content is not None
    assert len(context.summary.content) == SUMMARY_MAX_CHARS
    assert context.memories == ()
    assert len(context.recent_messages) == 10
    assert all(
        len(message.content) == RECENT_MESSAGE_MAX_CHARS for message in context.recent_messages
    )
    assert len(context.current_message.content) == CURRENT_MESSAGE_MAX_CHARS
    assert len(context.tools) == 16
