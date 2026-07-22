from pathlib import Path

import pytest
from pydantic import ValidationError

from mapping_memory.chat import (
    append_chat_turn,
    create_chat_thread,
    create_generation_turn,
    get_thread_summary,
    upsert_thread_summary,
)
from mapping_memory.chat_summary import (
    ChatSummaryOutput,
    rebuild_thread_summary,
    summarize_thread_incrementally,
)
from mapping_memory.db import init_db
from mapping_memory.schemas import AskEvidenceSummary, AskResponse


def _response() -> AskResponse:
    return AskResponse(
        answer="Answer",
        status="answered",
        evidence_summary=AskEvidenceSummary(source_count=0, snippet_count=0, match_types=[]),
        sources=[],
    )


def test_incremental_summary_leaves_the_latest_ten_qualifying_messages_raw(
    tmp_path: Path,
) -> None:
    sqlite_path = tmp_path / "summary.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(sqlite_path, "owner")
    for number in range(5):
        append_chat_turn(
            sqlite_path, "owner", f"Question {number}", _response(), thread_id=thread.id
        )
    create_generation_turn(sqlite_path, "owner", "Question 5", thread_id=thread.id)

    calls: list[tuple[str | None, list[dict[str, str]]]] = []

    def summarize(previous_summary: str | None, messages: list[dict[str, str]]) -> str:
        calls.append((previous_summary, messages))
        return "Earlier continuity"

    result = summarize_thread_incrementally(sqlite_path, "owner", thread.id, summarize=summarize)

    assert result == "updated"
    assert calls == [(None, [{"role": "user", "content": "Question 0"}])]
    stored = get_thread_summary(sqlite_path, "owner", thread.id)
    assert stored is not None
    assert stored.summary == "Earlier continuity"
    assert stored.last_summarized_message_id == 1


def test_rebuild_discards_prior_summary_and_clears_it_without_older_history(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "summary.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(sqlite_path, "owner")
    first = append_chat_turn(sqlite_path, "owner", "Question 0", _response(), thread_id=thread.id)
    for number in range(1, 5):
        append_chat_turn(
            sqlite_path, "owner", f"Question {number}", _response(), thread_id=thread.id
        )
    upsert_thread_summary(sqlite_path, "owner", thread.id, "Stale summary", first.user_message_id)

    assert (
        rebuild_thread_summary(sqlite_path, "owner", thread.id, summarize=lambda *_: "unused")
        == "updated"
    )
    assert get_thread_summary(sqlite_path, "owner", thread.id) is None


def test_incremental_summary_excludes_failed_assistant_content_and_preserves_prior_state_on_error(
    tmp_path: Path,
) -> None:
    sqlite_path = tmp_path / "summary.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(sqlite_path, "owner")
    append_chat_turn(sqlite_path, "owner", "Question 0", _response(), thread_id=thread.id)
    for number in range(1, 5):
        append_chat_turn(
            sqlite_path, "owner", f"Question {number}", _response(), thread_id=thread.id
        )
    failed = create_generation_turn(sqlite_path, "owner", "Keep failed user", thread_id=thread.id)
    from mapping_memory.chat import fail_generation_job, mark_generation_job_running

    assert mark_generation_job_running(sqlite_path, "owner", failed.id)
    assert fail_generation_job(
        sqlite_path, "owner", failed.id, "failed", "provider", "Provider failed"
    )

    captured: list[dict[str, str]] = []
    assert (
        summarize_thread_incrementally(
            sqlite_path,
            "owner",
            thread.id,
            summarize=lambda _, messages: captured.extend(messages) or "Summary",
        )
        == "updated"
    )
    assert captured == [{"role": "user", "content": "Question 0"}]
    stored = get_thread_summary(sqlite_path, "owner", thread.id)
    assert stored is not None

    append_chat_turn(sqlite_path, "owner", "Question 6", _response(), thread_id=thread.id)
    with pytest.raises(ValueError, match="blank"):
        summarize_thread_incrementally(sqlite_path, "owner", thread.id, summarize=lambda *_: "   ")
    assert get_thread_summary(sqlite_path, "owner", thread.id) == stored


def test_summary_output_is_trimmed_and_forbids_extra_fields() -> None:
    assert ChatSummaryOutput.model_validate({"summary": "  Compact  "}).summary == "Compact"
    with pytest.raises(ValidationError):
        ChatSummaryOutput.model_validate({"summary": "Valid", "extra": "no"})


def test_incremental_summary_returns_stale_when_history_changes_during_generation(
    tmp_path: Path,
) -> None:
    sqlite_path = tmp_path / "summary.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(sqlite_path, "owner")
    for number in range(5):
        append_chat_turn(
            sqlite_path, "owner", f"Question {number}", _response(), thread_id=thread.id
        )
    create_generation_turn(sqlite_path, "owner", "Question 5", thread_id=thread.id)

    def summarize(_: str | None, __: list[dict[str, str]]) -> str:
        append_chat_turn(sqlite_path, "owner", "Later question", _response(), thread_id=thread.id)
        return "Stale result"

    assert (
        summarize_thread_incrementally(sqlite_path, "owner", thread.id, summarize=summarize)
        == "stale"
    )
    assert get_thread_summary(sqlite_path, "owner", thread.id) is None
