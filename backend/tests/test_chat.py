# ruff: noqa: PT018
from pathlib import Path

import pytest

from mapping_memory.chat import (
    append_chat_turn,
    clear_chat,
    complete_generation_job,
    create_chat_thread,
    create_generation_turn,
    delete_chat_thread,
    fail_generation_job,
    get_chat_thread,
    get_generation_job,
    get_turn_scope,
    list_chat_messages,
    list_chat_threads,
    mark_generation_job_running,
    request_generation_job_cancellation,
    set_generation_job_progress,
    update_chat_thread,
)
from mapping_memory.db import init_db
from mapping_memory.schemas import AskEvidenceSummary, AskResponse


def _response() -> AskResponse:
    return AskResponse(
        answer="Use the saved checklist. [1]",
        status="answered",
        evidence_summary=AskEvidenceSummary(
            source_count=1, snippet_count=1, match_types=["semantic"]
        ),
        sources=[],
        memory_updates=1,
    )


def test_chat_transcript_persists_successful_turns_by_user_and_clears_independently(
    tmp_path: Path,
) -> None:
    sqlite_path = tmp_path / "chat.sqlite"
    init_db(sqlite_path)

    append_chat_turn(sqlite_path, "owner-a", "What did I save?", _response())
    append_chat_turn(sqlite_path, "owner-b", "Other question", _response())

    messages = list_chat_messages(sqlite_path, "owner-a")
    assert [message.role for message in messages] == ["user", "assistant"]
    assert messages[1].status == "completed"
    assert messages[1].evidence_summary is not None
    assert messages[1].created_at

    clear_chat(sqlite_path, "owner-a")
    assert list_chat_messages(sqlite_path, "owner-a") == []
    assert len(list_chat_messages(sqlite_path, "owner-b")) == 2


def test_chat_threads_crud_scope_validation_and_message_isolation(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "threads.sqlite"
    init_db(sqlite_path)

    first = create_chat_thread(sqlite_path, "owner-a")
    second = create_chat_thread(
        sqlite_path,
        "owner-a",
        title="Focused launch",
        scope={"mode": "custom", "note_ids": [3, 1, 3]},
    )
    other_owner = create_chat_thread(sqlite_path, "owner-b", title="Other")

    assert first.title == "Untitled chat"
    assert second.title == "Focused launch"
    assert second.scope == {"mode": "custom", "note_ids": [3, 1]}
    assert [thread.id for thread in list_chat_threads(sqlite_path, "owner-a")] == [
        second.id,
        first.id,
    ]

    append_chat_turn(sqlite_path, "owner-a", "First question", _response(), thread_id=first.id)
    append_chat_turn(sqlite_path, "owner-a", "Second question", _response(), thread_id=second.id)

    first_messages = list_chat_messages(sqlite_path, "owner-a", first.id)
    assert [message.content for message in first_messages] == [
        "First question",
        "Use the saved checklist. [1]",
    ]
    second_messages = list_chat_messages(sqlite_path, "owner-a", second.id)
    assert [message.content for message in second_messages] == [
        "Second question",
        "Use the saved checklist. [1]",
    ]

    renamed = update_chat_thread(
        sqlite_path,
        "owner-a",
        second.id,
        title="  Renamed launch  ",
        scope={"mode": "all"},
    )
    assert renamed is not None
    assert renamed.title == "Renamed launch"
    assert renamed.scope == {"mode": "all"}

    assert get_chat_thread(sqlite_path, "owner-a", other_owner.id) is None
    assert delete_chat_thread(sqlite_path, "owner-a", other_owner.id) is False
    assert delete_chat_thread(sqlite_path, "owner-a", first.id) is True
    assert list_chat_messages(sqlite_path, "owner-a", first.id) == []


def test_chat_thread_validation_rejects_blank_titles_and_invalid_scopes(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "threads.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(sqlite_path, "owner-a")

    with pytest.raises(ValueError, match="title must not be blank"):
        update_chat_thread(sqlite_path, "owner-a", thread.id, title=" ")

    for scope in [
        {"mode": "custom", "note_ids": [0]},
        {"mode": "missing"},
    ]:
        with pytest.raises(ValueError, match=r"scope|note_ids"):
            update_chat_thread(sqlite_path, "owner-a", thread.id, scope=scope)


def test_generation_turn_persists_immutable_ordered_scope_snapshot(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "jobs.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(
        sqlite_path,
        "owner-a",
        scope={"mode": "custom", "note_ids": [3, 1, 3]},
    )

    job = create_generation_turn(sqlite_path, "owner-a", "Question", thread_id=thread.id)

    assert job.status == "queued"
    assert job.progress_stage == "queued"
    assert get_turn_scope(sqlite_path, "owner-a", job.user_message_id) == {
        "mode": "custom",
        "note_ids": [3, 1],
    }
    assert update_chat_thread(sqlite_path, "owner-a", thread.id, scope={"mode": "all"})
    assert get_turn_scope(sqlite_path, "owner-a", job.user_message_id) == {
        "mode": "custom",
        "note_ids": [3, 1],
    }


def test_generation_turn_all_and_empty_custom_scope_snapshots(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "jobs.sqlite"
    init_db(sqlite_path)
    all_thread = create_chat_thread(sqlite_path, "owner-a")
    empty_custom = create_chat_thread(
        sqlite_path, "owner-a", scope={"mode": "custom", "note_ids": []}
    )

    all_job = create_generation_turn(sqlite_path, "owner-a", "All", thread_id=all_thread.id)
    empty_job = create_generation_turn(sqlite_path, "owner-a", "None", thread_id=empty_custom.id)

    assert get_turn_scope(sqlite_path, "owner-a", all_job.user_message_id) == {"mode": "all"}
    assert get_turn_scope(sqlite_path, "owner-a", empty_job.user_message_id) == {
        "mode": "custom",
        "note_ids": [],
    }


def test_generation_job_lifecycle_errors_and_cancellation(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "jobs.sqlite"
    init_db(sqlite_path)
    job = create_generation_turn(sqlite_path, "owner-a", "Question")

    with pytest.raises(ValueError, match="running"):
        set_generation_job_progress(sqlite_path, "owner-a", job.id, "retrieving")
    running = mark_generation_job_running(sqlite_path, "owner-a", job.id)
    assert running is not None and running.started_at is not None
    retrieving = set_generation_job_progress(sqlite_path, "owner-a", job.id, "retrieving")
    assert retrieving is not None and retrieving.progress_stage == "retrieving"
    completed = complete_generation_job(sqlite_path, "owner-a", job.id, _response())
    assert completed is not None and completed.status == "completed"
    assert completed.finished_at is not None and completed.error_category is None
    with pytest.raises(ValueError, match="terminal"):
        fail_generation_job(sqlite_path, "owner-a", job.id, "failed", "internal", "Nope")

    cancelled = create_generation_turn(sqlite_path, "owner-a", "Cancel")
    cancellation = request_generation_job_cancellation(sqlite_path, "owner-a", cancelled.id)
    assert cancellation is not None
    assert cancellation.status == "cancelled"
    assert cancellation.cancel_requested is True
    assert cancellation.error_category == "cancelled"


def test_generation_job_rejects_incompatible_terminal_error(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "jobs.sqlite"
    init_db(sqlite_path)
    job = create_generation_turn(sqlite_path, "owner-a", "Question")
    assert mark_generation_job_running(sqlite_path, "owner-a", job.id)

    with pytest.raises(ValueError, match="compatible"):
        fail_generation_job(sqlite_path, "owner-a", job.id, "timed_out", "provider", "Timed out")
    failed = fail_generation_job(
        sqlite_path, "owner-a", job.id, "timed_out", "timeout", "Timed out"
    )
    assert failed is not None and failed.status == "timed_out"
    assert get_generation_job(sqlite_path, "owner-a", job.id) == failed
