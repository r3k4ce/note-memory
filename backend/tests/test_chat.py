# ruff: noqa: PT018
from pathlib import Path

import pytest

from mapping_memory.chat import (
    append_chat_turn,
    automatic_memory_change_matches_current_memory,
    clear_chat,
    complete_generation_job,
    create_chat_thread,
    create_generation_turn,
    delete_chat_thread,
    fail_generation_job,
    get_assistant_reply_audit,
    get_automatic_memory_change,
    get_chat_thread,
    get_generation_job,
    get_thread_summary,
    get_turn_scope,
    list_automatic_memory_changes_for_turn,
    list_chat_messages,
    list_chat_threads,
    mark_generation_job_running,
    record_automatic_memory_change,
    request_generation_job_cancellation,
    set_automatic_thread_title,
    set_generation_job_progress,
    update_chat_thread,
    upsert_thread_summary,
)
from mapping_memory.db import connect_db, init_db
from mapping_memory.schemas import (
    AskEvidenceSummary,
    AskResponse,
    AssistantClaim,
    AssistantReplyAudit,
    AssistantSourceSnapshot,
    AssistantValidationResult,
)


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


def _audit() -> AssistantReplyAudit:
    return AssistantReplyAudit(
        sources=[
            AssistantSourceSnapshot(
                source_id="web-1",
                source_type="web",
                title="Release notes",
                source_date="2026-07-02",
                cited_snippet="The rollout starts on Monday.",
                citation_order=2,
                url="https://example.com/release-notes",
            ),
            AssistantSourceSnapshot(
                source_id="note-1",
                source_type="note",
                title="Launch checklist",
                source_date="2026-07-01",
                cited_snippet="Ship the checklist before the rollout.",
                citation_order=1,
                note_id=1,
                source_start=10,
                source_end=47,
                note_version_updated_at="2026-07-01T12:00:00+00:00",
            ),
        ],
        claims=[
            AssistantClaim(
                claim_id="claim-1",
                text="The checklist ships before rollout.",
                source_ids=["note-1", "web-1"],
            )
        ],
        validation_results=[
            AssistantValidationResult(
                result_id="code-1", kind="code", outcome="passed", details={"rule": "citations"}
            ),
            AssistantValidationResult(
                result_id="semantic-1",
                kind="semantic",
                outcome="failed",
                details={"reason": "unsupported claim"},
            ),
        ],
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


def test_thread_title_origin_stays_internal_and_prevents_first_question_copy(
    tmp_path: Path,
) -> None:
    sqlite_path = tmp_path / "threads.sqlite"
    init_db(sqlite_path)

    automatic = create_chat_thread(sqlite_path, "owner-a")
    manual = create_chat_thread(sqlite_path, "owner-a", title="Launch")
    assert set_automatic_thread_title(sqlite_path, "owner-a", automatic.id, "Generated")
    assert get_chat_thread(sqlite_path, "owner-a", automatic.id).title == "Generated"  # type: ignore[union-attr]
    assert set_automatic_thread_title(sqlite_path, "owner-a", manual.id, "Ignored") is None

    renamed = update_chat_thread(sqlite_path, "owner-a", automatic.id, title="Renamed")
    assert renamed is not None
    assert update_chat_thread(sqlite_path, "owner-a", automatic.id, scope={"mode": "all"})
    assert set_automatic_thread_title(sqlite_path, "owner-a", automatic.id, "Ignored") is None

    implicit_job = create_generation_turn(sqlite_path, "owner-b", "First question")
    implicit_thread = get_chat_thread(sqlite_path, "owner-b", implicit_job.thread_id)
    assert implicit_thread is not None and implicit_thread.title == "Untitled chat"

    with connect_db(sqlite_path) as connection:
        origins = {
            row["id"]: row["title_origin"]
            for row in connection.execute("SELECT id, title_origin FROM chat_threads")
        }
    assert origins[automatic.id] == "manual"
    assert origins[manual.id] == "manual"
    assert origins[implicit_job.thread_id] == "automatic"


def test_thread_summaries_are_owner_and_thread_scoped_and_cascade(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "summaries.sqlite"
    init_db(sqlite_path)
    first = create_chat_thread(sqlite_path, "owner-a")
    second = create_chat_thread(sqlite_path, "owner-a")
    other = create_chat_thread(sqlite_path, "owner-b")
    first_job = create_generation_turn(sqlite_path, "owner-a", "First", thread_id=first.id)
    second_job = create_generation_turn(sqlite_path, "owner-a", "Second", thread_id=second.id)
    other_job = create_generation_turn(sqlite_path, "owner-b", "Other", thread_id=other.id)

    stored = upsert_thread_summary(
        sqlite_path, "owner-a", first.id, "First summary", first_job.user_message_id
    )
    assert stored.summary == "First summary"
    assert stored.last_summarized_message_id == first_job.user_message_id
    replaced = upsert_thread_summary(
        sqlite_path, "owner-a", first.id, "Replacement", first_job.assistant_message_id
    )
    assert replaced.summary == "Replacement"
    assert replaced.last_summarized_message_id == first_job.assistant_message_id
    assert get_thread_summary(sqlite_path, "owner-a", first.id) == replaced

    with pytest.raises(ValueError, match="thread"):
        upsert_thread_summary(sqlite_path, "owner-a", first.id, "Wrong", second_job.user_message_id)
    with pytest.raises(ValueError, match="thread"):
        upsert_thread_summary(sqlite_path, "owner-a", first.id, "Wrong", other_job.user_message_id)
    assert get_thread_summary(sqlite_path, "owner-b", first.id) is None

    assert delete_chat_thread(sqlite_path, "owner-a", first.id)
    with connect_db(sqlite_path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM chat_thread_summaries").fetchone()[0] == 0


def test_automatic_memory_change_provenance_tracks_exact_current_memory(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "provenance.sqlite"
    init_db(sqlite_path)
    thread = create_chat_thread(sqlite_path, "owner-a")
    job = create_generation_turn(sqlite_path, "owner-a", "Remember this", thread_id=thread.id)

    added = record_automatic_memory_change(
        sqlite_path,
        "owner-a",
        thread.id,
        job.user_message_id,
        job.id,
        operation="ADD",
        provider_memory_id="mem-1",
        prior_content=None,
        resulting_content="Likes tea",
    )
    updated = record_automatic_memory_change(
        sqlite_path,
        "owner-a",
        thread.id,
        job.user_message_id,
        job.id,
        operation="UPDATE",
        provider_memory_id="mem-1",
        prior_content="Likes tea",
        resulting_content="Likes oolong tea",
    )
    assert added.prior_content is None
    assert updated.prior_content == "Likes tea"
    assert updated.resulting_content_fingerprint != updated.prior_content_fingerprint
    assert get_automatic_memory_change(sqlite_path, "owner-a", updated.id) == updated
    assert list_automatic_memory_changes_for_turn(sqlite_path, "owner-a", job.user_message_id) == [
        added,
        updated,
    ]
    assert automatic_memory_change_matches_current_memory(
        sqlite_path, "owner-a", updated.id, "mem-1", "Likes oolong tea"
    )
    assert not automatic_memory_change_matches_current_memory(
        sqlite_path, "owner-a", updated.id, "mem-2", "Likes oolong tea"
    )
    assert not automatic_memory_change_matches_current_memory(
        sqlite_path, "owner-a", updated.id, "mem-1", "Manually edited"
    )

    with pytest.raises(ValueError, match="ADD"):
        record_automatic_memory_change(
            sqlite_path,
            "owner-a",
            thread.id,
            job.user_message_id,
            job.id,
            operation="ADD",
            provider_memory_id="mem-2",
            prior_content="old",
            resulting_content="new",
        )
    with pytest.raises(ValueError, match="UPDATE"):
        record_automatic_memory_change(
            sqlite_path,
            "owner-a",
            thread.id,
            job.user_message_id,
            job.id,
            operation="UPDATE",
            provider_memory_id="mem-2",
            prior_content=None,
            resulting_content="new",
        )
    other_thread = create_chat_thread(sqlite_path, "owner-a")
    with pytest.raises(ValueError, match="same thread"):
        record_automatic_memory_change(
            sqlite_path,
            "owner-a",
            other_thread.id,
            job.user_message_id,
            job.id,
            operation="ADD",
            provider_memory_id="mem-3",
            prior_content=None,
            resulting_content="new",
        )

    assert delete_chat_thread(sqlite_path, "owner-a", thread.id)
    with connect_db(sqlite_path) as connection:
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM automatic_memory_change_provenance"
            ).fetchone()[0]
            == 0
        )


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


def test_tool_backed_audit_round_trips_in_normalized_order_and_cascades(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "audit.sqlite"
    init_db(sqlite_path)
    with connect_db(sqlite_path) as connection:
        connection.execute(
            """INSERT INTO notes (
                id, original_text, ai_title, short_summary, tags_json, date_added, updated_at
            ) VALUES (1, 'Note', 'Title', 'Summary', '[]', '2026-07-01', '2026-07-01')"""
        )
        connection.commit()
    job = create_generation_turn(sqlite_path, "owner-a", "Question")
    assert mark_generation_job_running(sqlite_path, "owner-a", job.id)
    assert complete_generation_job(sqlite_path, "owner-a", job.id, _response(), audit=_audit())

    stored = get_assistant_reply_audit(sqlite_path, "owner-a", job.assistant_message_id)
    assert stored is not None
    assert [source.source_id for source in stored.sources] == ["note-1", "web-1"]
    assert stored.sources[0].note_version_updated_at == "2026-07-01T12:00:00+00:00"
    assert stored.sources[1].url == "https://example.com/release-notes"
    assert stored.claims[0].source_ids == ["note-1", "web-1"]
    assert [
        (result.kind, result.outcome, result.details) for result in stored.validation_results
    ] == [
        ("code", "passed", {"rule": "citations"}),
        ("semantic", "failed", {"reason": "unsupported claim"}),
    ]
    assert list_chat_messages(sqlite_path, "owner-a")[1].sources == []

    with connect_db(sqlite_path) as connection:
        connection.execute("DELETE FROM notes WHERE id = 1")
        connection.commit()
        snapshot_after_note_delete = connection.execute(
            "SELECT note_id FROM assistant_source_snapshots WHERE assistant_message_id = ?",
            (job.assistant_message_id,),
        ).fetchone()
        connection.execute("DELETE FROM chat_messages WHERE id = ?", (job.assistant_message_id,))
        connection.commit()
        audit_counts = [
            connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "assistant_source_snapshots",
                "assistant_claims",
                "assistant_claim_sources",
                "assistant_validation_results",
            )
        ]

    assert snapshot_after_note_delete is not None
    assert snapshot_after_note_delete["note_id"] == 1
    assert audit_counts == [0, 0, 0, 0]


def test_direct_reply_creates_no_audit_rows(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "direct.sqlite"
    init_db(sqlite_path)
    append_chat_turn(sqlite_path, "owner-a", "Question", _response())

    with connect_db(sqlite_path) as connection:
        counts = [
            connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "assistant_source_snapshots",
                "assistant_claims",
                "assistant_claim_sources",
                "assistant_validation_results",
            )
        ]

    assert counts == [0, 0, 0, 0]


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
