# ruff: noqa: E501
import json
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel

from mapping_memory.db import connect_db
from mapping_memory.schemas import (
    AskEvidenceSummary,
    AskResponse,
    AssistantClaim,
    AssistantReplyAudit,
    AssistantSourceSnapshot,
    AssistantValidationResult,
    ChatMessageRead,
    ChatThreadRead,
)

DEFAULT_THREAD_TITLE = "Untitled chat"
DEFAULT_SCOPE = {"mode": "all"}
MAX_THREAD_TITLE_LENGTH = 120
JobStatus = Literal[
    "queued", "running", "completed", "failed", "timed_out", "interrupted", "cancelled"
]
ProgressStage = Literal["queued", "retrieving", "generating", "finalizing"]
ErrorCategory = Literal[
    "retrieval",
    "provider",
    "rate_limited",
    "validation",
    "internal",
    "timeout",
    "interrupted",
    "cancelled",
]
TerminalFailureStatus = Literal["failed", "timed_out", "interrupted", "cancelled"]


class GenerationJobRead(BaseModel):
    id: int
    thread_id: int
    user_message_id: int
    assistant_message_id: int
    status: JobStatus
    progress_stage: ProgressStage
    cancel_requested: bool
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    updated_at: str
    cancel_requested_at: str | None = None
    error_category: ErrorCategory | None = None
    user_facing_error: str | None = None


def create_chat_thread(
    sqlite_path: Path,
    user_id: str,
    *,
    title: str | None = None,
    scope: dict[str, Any] | None = None,
) -> ChatThreadRead:
    now = _now()
    with closing(connect_db(sqlite_path)) as connection:
        cursor = connection.execute(
            """INSERT INTO chat_threads (user_id, title, scope_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)""",
            (
                user_id,
                _normalize_thread_title(title or DEFAULT_THREAD_TITLE),
                _scope_json(_normalize_scope(scope)),
                now,
                now,
            ),
        )
        connection.commit()
    if cursor.lastrowid is None:
        raise RuntimeError("created chat thread did not return an id")
    thread = get_chat_thread(sqlite_path, user_id, cursor.lastrowid)
    if thread is None:
        raise RuntimeError("created chat thread could not be read")
    return thread


def list_chat_threads(sqlite_path: Path, user_id: str) -> list[ChatThreadRead]:
    with closing(connect_db(sqlite_path)) as connection:
        rows = connection.execute(
            "SELECT * FROM chat_threads WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
            (user_id,),
        ).fetchall()
    return [_chat_thread_from_row(row) for row in rows]


def get_chat_thread(sqlite_path: Path, user_id: str, thread_id: int) -> ChatThreadRead | None:
    with closing(connect_db(sqlite_path)) as connection:
        row = connection.execute(
            "SELECT * FROM chat_threads WHERE user_id = ? AND id = ?", (user_id, thread_id)
        ).fetchone()
    return _chat_thread_from_row(row) if row is not None else None


def update_chat_thread(
    sqlite_path: Path,
    user_id: str,
    thread_id: int,
    *,
    title: str | None = None,
    scope: dict[str, Any] | None = None,
) -> ChatThreadRead | None:
    if title is None and scope is None:
        raise ValueError("at least one update field must be provided")
    updates: list[str] = []
    values: list[Any] = []
    if title is not None:
        updates.append("title = ?")
        values.append(_normalize_thread_title(title))
    if scope is not None:
        updates.append("scope_json = ?")
        values.append(_scope_json(_normalize_scope(scope)))
    updates.append("updated_at = ?")
    values.extend([_now(), user_id, thread_id])
    with closing(connect_db(sqlite_path)) as connection:
        cursor = connection.execute(
            f"UPDATE chat_threads SET {', '.join(updates)} WHERE user_id = ? AND id = ?", values
        )
        connection.commit()
    return get_chat_thread(sqlite_path, user_id, thread_id) if cursor.rowcount else None


def delete_chat_thread(sqlite_path: Path, user_id: str, thread_id: int) -> bool:
    with closing(connect_db(sqlite_path)) as connection:
        cursor = connection.execute(
            "DELETE FROM chat_threads WHERE user_id = ? AND id = ?", (user_id, thread_id)
        )
        connection.commit()
    return cursor.rowcount > 0


def create_generation_turn(
    sqlite_path: Path, user_id: str, question: str, *, thread_id: int | None = None
) -> GenerationJobRead:
    with closing(connect_db(sqlite_path)) as connection:
        with connection:
            job_id = _create_generation_turn(connection, user_id, question, thread_id=thread_id)
        row = _get_job_row(connection, user_id, job_id)
    if row is None:
        raise RuntimeError("created generation job could not be read")
    return _job_from_row(row)


def mark_generation_job_running(
    sqlite_path: Path, user_id: str, job_id: int
) -> GenerationJobRead | None:
    return _transition_running(sqlite_path, user_id, job_id)


def set_generation_job_progress(
    sqlite_path: Path, user_id: str, job_id: int, progress_stage: ProgressStage
) -> GenerationJobRead | None:
    if progress_stage == "queued":
        raise ValueError("running jobs cannot return to queued progress")
    with closing(connect_db(sqlite_path)) as connection:
        with connection:
            _require_active_job(connection, user_id, job_id, expected="running")
            connection.execute(
                "UPDATE generation_jobs SET progress_stage = ?, updated_at = ? WHERE id = ?",
                (progress_stage, _now(), job_id),
            )
        row = _get_job_row(connection, user_id, job_id)
    return _job_from_row(row) if row else None


def complete_generation_job(
    sqlite_path: Path,
    user_id: str,
    job_id: int,
    response: AskResponse,
    *,
    audit: AssistantReplyAudit | None = None,
) -> GenerationJobRead | None:
    with closing(connect_db(sqlite_path)) as connection:
        with connection:
            job = _require_active_job(connection, user_id, job_id, expected="running")
            now = _now()
            connection.execute(
                """UPDATE chat_messages SET content = ?, status = 'completed', evidence_summary_json = ?
                   WHERE id = ?""",
                (
                    response.answer,
                    response.evidence_summary.model_dump_json(),
                    job["assistant_message_id"],
                ),
            )
            connection.execute(
                """UPDATE generation_jobs SET status = 'completed', progress_stage = 'finalizing',
                   finished_at = ?, updated_at = ? WHERE id = ?""",
                (now, now, job_id),
            )
            if audit is not None:
                _write_assistant_reply_audit(connection, job, audit)
        row = _get_job_row(connection, user_id, job_id)
    return _job_from_row(row) if row else None


def fail_generation_job(
    sqlite_path: Path,
    user_id: str,
    job_id: int,
    status: TerminalFailureStatus,
    error_category: ErrorCategory,
    user_facing_error: str,
) -> GenerationJobRead | None:
    _validate_terminal_error(status, error_category, user_facing_error)
    with closing(connect_db(sqlite_path)) as connection:
        with connection:
            job = _require_active_job(connection, user_id, job_id, expected="running")
            now = _now()
            connection.execute(
                "UPDATE chat_messages SET status = ? WHERE id = ?",
                (status, job["assistant_message_id"]),
            )
            connection.execute(
                """UPDATE generation_jobs SET status = ?, progress_stage = 'finalizing', error_category = ?,
                   user_facing_error = ?, finished_at = ?, updated_at = ?,
                   cancel_requested = CASE WHEN ? = 'cancelled' THEN 1 ELSE cancel_requested END,
                   cancel_requested_at = CASE WHEN ? = 'cancelled' THEN COALESCE(cancel_requested_at, ?) ELSE cancel_requested_at END
                   WHERE id = ?""",
                (
                    status,
                    error_category,
                    user_facing_error.strip(),
                    now,
                    now,
                    status,
                    status,
                    now,
                    job_id,
                ),
            )
        row = _get_job_row(connection, user_id, job_id)
    return _job_from_row(row) if row else None


def request_generation_job_cancellation(
    sqlite_path: Path, user_id: str, job_id: int
) -> GenerationJobRead | None:
    with closing(connect_db(sqlite_path)) as connection:
        with connection:
            job = _get_job_row(connection, user_id, job_id)
            if job is None:
                return None
            if job["status"] not in {"queued", "running"}:
                raise ValueError("terminal generation jobs are immutable")
            now = _now()
            if job["status"] == "queued":
                connection.execute(
                    "UPDATE chat_messages SET status = 'cancelled' WHERE id = ?",
                    (job["assistant_message_id"],),
                )
                connection.execute(
                    """UPDATE generation_jobs SET status = 'cancelled', progress_stage = 'finalizing',
                       cancel_requested = 1, cancel_requested_at = ?, error_category = 'cancelled',
                       user_facing_error = 'Cancelled', finished_at = ?, updated_at = ? WHERE id = ?""",
                    (now, now, now, job_id),
                )
            else:
                connection.execute(
                    """UPDATE generation_jobs SET cancel_requested = 1,
                       cancel_requested_at = COALESCE(cancel_requested_at, ?), updated_at = ? WHERE id = ?""",
                    (now, now, job_id),
                )
        row = _get_job_row(connection, user_id, job_id)
    return _job_from_row(row) if row else None


def get_generation_job(sqlite_path: Path, user_id: str, job_id: int) -> GenerationJobRead | None:
    with closing(connect_db(sqlite_path)) as connection:
        row = _get_job_row(connection, user_id, job_id)
    return _job_from_row(row) if row else None


def get_turn_scope(sqlite_path: Path, user_id: str, user_message_id: int) -> dict[str, Any] | None:
    with closing(connect_db(sqlite_path)) as connection:
        scope = connection.execute(
            """SELECT scopes.mode FROM chat_turn_scopes AS scopes
               JOIN chat_messages AS messages ON messages.id = scopes.user_message_id
               WHERE messages.user_id = ? AND messages.role = 'user' AND messages.id = ?""",
            (user_id, user_message_id),
        ).fetchone()
        if scope is None:
            return None
        ids = connection.execute(
            "SELECT note_id FROM chat_turn_scope_note_ids WHERE user_message_id = ? ORDER BY position",
            (user_message_id,),
        ).fetchall()
    return (
        {"mode": scope["mode"]}
        if scope["mode"] == "all"
        else {"mode": "custom", "note_ids": [row["note_id"] for row in ids]}
    )


def append_chat_turn(
    sqlite_path: Path,
    user_id: str,
    question: str,
    response: AskResponse,
    *,
    thread_id: int | None = None,
    audit: AssistantReplyAudit | None = None,
) -> None:
    with closing(connect_db(sqlite_path)) as connection, connection:
        job_id = _create_generation_turn(connection, user_id, question, thread_id=thread_id)
        _mark_running(connection, user_id, job_id)
        _complete_job(connection, user_id, job_id, response, audit=audit)


def list_chat_messages(
    sqlite_path: Path, user_id: str, thread_id: int | None = None
) -> list[ChatMessageRead]:
    with closing(connect_db(sqlite_path)) as connection:
        if thread_id is None:
            latest = connection.execute(
                "SELECT id FROM chat_threads WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            if latest is None:
                return []
            thread_id = latest["id"]
        rows = connection.execute(
            "SELECT * FROM chat_messages WHERE user_id = ? AND thread_id = ? ORDER BY id",
            (user_id, thread_id),
        ).fetchall()
    return [_message_from_row(row) for row in rows]


def get_assistant_reply_audit(
    sqlite_path: Path, user_id: str, assistant_message_id: int
) -> AssistantReplyAudit | None:
    with closing(connect_db(sqlite_path)) as connection:
        message = connection.execute(
            """SELECT id FROM chat_messages
               WHERE id = ? AND user_id = ? AND role = 'assistant'""",
            (assistant_message_id, user_id),
        ).fetchone()
        if message is None:
            return None
        source_rows = connection.execute(
            """SELECT * FROM assistant_source_snapshots
               WHERE assistant_message_id = ? ORDER BY citation_order""",
            (assistant_message_id,),
        ).fetchall()
        claim_rows = connection.execute(
            """SELECT claims.*, snapshots.source_id
               FROM assistant_claims AS claims
               LEFT JOIN assistant_claim_sources AS mappings ON mappings.assistant_claim_id = claims.id
               LEFT JOIN assistant_source_snapshots AS snapshots
                 ON snapshots.id = mappings.assistant_source_snapshot_id
               WHERE claims.assistant_message_id = ?
               ORDER BY claims.claim_order, mappings.position""",
            (assistant_message_id,),
        ).fetchall()
        validation_rows = connection.execute(
            """SELECT * FROM assistant_validation_results
               WHERE assistant_message_id = ? ORDER BY result_order""",
            (assistant_message_id,),
        ).fetchall()
    if not source_rows and not claim_rows and not validation_rows:
        return None
    sources = [_source_snapshot_from_row(row) for row in source_rows]
    claims = _claims_from_rows(claim_rows)
    validations = [_validation_result_from_row(row) for row in validation_rows]
    return AssistantReplyAudit(sources=sources, claims=claims, validation_results=validations)


def clear_chat(sqlite_path: Path, user_id: str) -> None:
    with closing(connect_db(sqlite_path)) as connection:
        latest = connection.execute(
            "SELECT id FROM chat_threads WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
            (user_id,),
        ).fetchone()
        if latest:
            connection.execute(
                "DELETE FROM chat_messages WHERE user_id = ? AND thread_id = ?",
                (user_id, latest["id"]),
            )
        connection.commit()


def learning_enabled(sqlite_path: Path, user_id: str) -> bool:
    with closing(connect_db(sqlite_path)) as connection:
        row = connection.execute(
            "SELECT learning_enabled FROM memory_settings WHERE user_id = ?", (user_id,)
        ).fetchone()
    return True if row is None else bool(row["learning_enabled"])


def set_learning_enabled(sqlite_path: Path, user_id: str, enabled: bool) -> None:
    with closing(connect_db(sqlite_path)) as connection:
        connection.execute(
            """INSERT INTO memory_settings (user_id, learning_enabled) VALUES (?, ?)
            ON CONFLICT(user_id) DO UPDATE SET learning_enabled = excluded.learning_enabled""",
            (user_id, int(enabled)),
        )
        connection.commit()


def _create_generation_turn(
    connection: Any, user_id: str, question: str, *, thread_id: int | None
) -> int:
    now = _now()
    thread = _resolve_thread(connection, user_id, thread_id, now)
    scope = _normalize_scope(json.loads(thread["scope_json"]))
    user_message = connection.execute(
        """INSERT INTO chat_messages (user_id, thread_id, role, content, status, created_at)
           VALUES (?, ?, 'user', ?, 'completed', ?)""",
        (user_id, thread["id"], question, now),
    )
    assistant_message = connection.execute(
        """INSERT INTO chat_messages (user_id, thread_id, role, content, status, created_at)
           VALUES (?, ?, 'assistant', '', 'pending', ?)""",
        (user_id, thread["id"], now),
    )
    if user_message.lastrowid is None or assistant_message.lastrowid is None:
        raise RuntimeError("created chat messages did not return ids")
    connection.execute(
        "INSERT INTO chat_turn_scopes (user_message_id, mode) VALUES (?, ?)",
        (user_message.lastrowid, scope["mode"]),
    )
    for position, note_id in enumerate(scope.get("note_ids", [])):
        connection.execute(
            "INSERT INTO chat_turn_scope_note_ids (user_message_id, position, note_id) VALUES (?, ?, ?)",
            (user_message.lastrowid, position, note_id),
        )
    job = connection.execute(
        """INSERT INTO generation_jobs (user_id, thread_id, user_message_id, assistant_message_id,
           status, progress_stage, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 'queued', ?, ?)""",
        (user_id, thread["id"], user_message.lastrowid, assistant_message.lastrowid, now, now),
    )
    title = (
        _title_from_question(question)
        if thread["title"] == DEFAULT_THREAD_TITLE
        and _thread_user_message_count(connection, user_id, thread["id"]) == 1
        else thread["title"]
    )
    connection.execute(
        "UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?", (title, now, thread["id"])
    )
    if job.lastrowid is None:
        raise RuntimeError("created generation job did not return an id")
    return int(job.lastrowid)


def _resolve_thread(connection: Any, user_id: str, thread_id: int | None, now: str) -> Any:
    if thread_id is not None:
        thread = connection.execute(
            "SELECT * FROM chat_threads WHERE user_id = ? AND id = ?", (user_id, thread_id)
        ).fetchone()
        if thread is None:
            raise ValueError("chat thread not found")
        return thread
    thread = connection.execute(
        "SELECT * FROM chat_threads WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 1",
        (user_id,),
    ).fetchone()
    if thread is not None:
        return thread
    cursor = connection.execute(
        """INSERT INTO chat_threads (user_id, title, scope_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)""",
        (user_id, DEFAULT_THREAD_TITLE, _scope_json(DEFAULT_SCOPE), now, now),
    )
    return connection.execute(
        "SELECT * FROM chat_threads WHERE id = ?", (cursor.lastrowid,)
    ).fetchone()


def _transition_running(sqlite_path: Path, user_id: str, job_id: int) -> GenerationJobRead | None:
    with closing(connect_db(sqlite_path)) as connection:
        with connection:
            _mark_running(connection, user_id, job_id)
        row = _get_job_row(connection, user_id, job_id)
    return _job_from_row(row) if row else None


def _mark_running(connection: Any, user_id: str, job_id: int) -> None:
    _require_active_job(connection, user_id, job_id, expected="queued")
    now = _now()
    connection.execute(
        "UPDATE generation_jobs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ?",
        (now, now, job_id),
    )


def _complete_job(
    connection: Any,
    user_id: str,
    job_id: int,
    response: AskResponse,
    *,
    audit: AssistantReplyAudit | None = None,
) -> None:
    job = _require_active_job(connection, user_id, job_id, expected="running")
    now = _now()
    connection.execute(
        """UPDATE chat_messages SET content = ?, status = 'completed', evidence_summary_json = ? WHERE id = ?""",
        (
            response.answer,
            response.evidence_summary.model_dump_json(),
            job["assistant_message_id"],
        ),
    )
    connection.execute(
        "UPDATE generation_jobs SET status = 'completed', progress_stage = 'finalizing', finished_at = ?, updated_at = ? WHERE id = ?",
        (now, now, job_id),
    )
    if audit is not None:
        _write_assistant_reply_audit(connection, job, audit)


def _write_assistant_reply_audit(connection: Any, job: Any, audit: AssistantReplyAudit) -> None:
    source_row_ids: dict[str, int] = {}
    for source in audit.sources:
        cursor = connection.execute(
            """INSERT INTO assistant_source_snapshots (
                assistant_message_id, generation_job_id, source_id, source_type, title, source_date,
                cited_snippet, citation_order, note_id, source_start, source_end,
                note_version_updated_at, url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                job["assistant_message_id"],
                job["id"],
                source.source_id,
                source.source_type,
                source.title,
                source.source_date,
                source.cited_snippet,
                source.citation_order,
                source.note_id,
                source.source_start,
                source.source_end,
                source.note_version_updated_at,
                source.url,
            ),
        )
        if cursor.lastrowid is None:
            raise RuntimeError("created assistant source did not return an id")
        source_row_ids[source.source_id] = int(cursor.lastrowid)
    for claim_order, claim in enumerate(audit.claims, start=1):
        cursor = connection.execute(
            """INSERT INTO assistant_claims (
                assistant_message_id, generation_job_id, claim_id, claim_text, claim_order
            ) VALUES (?, ?, ?, ?, ?)""",
            (job["assistant_message_id"], job["id"], claim.claim_id, claim.text, claim_order),
        )
        if cursor.lastrowid is None:
            raise RuntimeError("created assistant claim did not return an id")
        for position, source_id in enumerate(claim.source_ids, start=1):
            connection.execute(
                """INSERT INTO assistant_claim_sources (
                    assistant_message_id, generation_job_id, assistant_claim_id,
                    assistant_source_snapshot_id, position
                ) VALUES (?, ?, ?, ?, ?)""",
                (
                    job["assistant_message_id"],
                    job["id"],
                    cursor.lastrowid,
                    source_row_ids[source_id],
                    position,
                ),
            )
    for result_order, result in enumerate(audit.validation_results, start=1):
        connection.execute(
            """INSERT INTO assistant_validation_results (
                assistant_message_id, generation_job_id, result_id, kind, outcome, details_json,
                result_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (
                job["assistant_message_id"],
                job["id"],
                result.result_id,
                result.kind,
                result.outcome,
                json.dumps(result.details, separators=(",", ":"), ensure_ascii=False),
                result_order,
            ),
        )


def _source_snapshot_from_row(row: Any) -> AssistantSourceSnapshot:
    return AssistantSourceSnapshot(
        source_id=row["source_id"],
        source_type=row["source_type"],
        title=row["title"],
        source_date=row["source_date"],
        cited_snippet=row["cited_snippet"],
        citation_order=row["citation_order"],
        note_id=row["note_id"],
        source_start=row["source_start"],
        source_end=row["source_end"],
        note_version_updated_at=row["note_version_updated_at"],
        url=row["url"],
    )


def _claims_from_rows(rows: list[Any]) -> list[AssistantClaim]:
    claims: list[AssistantClaim] = []
    current_id: int | None = None
    current_claim: dict[str, Any] | None = None
    source_ids: list[str] = []
    for row in rows:
        if row["id"] != current_id:
            if current_claim is not None:
                claims.append(AssistantClaim(**current_claim, source_ids=source_ids))
            current_id = row["id"]
            current_claim = {"claim_id": row["claim_id"], "text": row["claim_text"]}
            source_ids = []
        if row["source_id"] is not None:
            source_ids.append(row["source_id"])
    if current_claim is not None:
        claims.append(AssistantClaim(**current_claim, source_ids=source_ids))
    return claims


def _validation_result_from_row(row: Any) -> AssistantValidationResult:
    return AssistantValidationResult(
        result_id=row["result_id"],
        kind=row["kind"],
        outcome=row["outcome"],
        details=json.loads(row["details_json"]),
    )


def _require_active_job(connection: Any, user_id: str, job_id: int, *, expected: str) -> Any:
    job = _get_job_row(connection, user_id, job_id)
    if job is None:
        raise ValueError("generation job not found")
    if job["status"] in {"completed", "failed", "timed_out", "interrupted", "cancelled"}:
        raise ValueError("terminal generation jobs are immutable")
    if job["status"] != expected:
        raise ValueError(f"generation job must be {expected}")
    return job


def _get_job_row(connection: Any, user_id: str, job_id: int) -> Any:
    return connection.execute(
        "SELECT * FROM generation_jobs WHERE user_id = ? AND id = ?", (user_id, job_id)
    ).fetchone()


def _validate_terminal_error(
    status: TerminalFailureStatus, category: ErrorCategory, error: str
) -> None:
    compatible = {
        "failed": {"retrieval", "provider", "rate_limited", "validation", "internal"},
        "timed_out": {"timeout"},
        "interrupted": {"interrupted"},
        "cancelled": {"cancelled"},
    }
    if category not in compatible[status]:
        raise ValueError("error category is not compatible with terminal status")
    if not error.strip():
        raise ValueError("user-facing error must not be blank")


def _job_from_row(row: Any) -> GenerationJobRead:
    values = dict(row)
    values["cancel_requested"] = bool(values["cancel_requested"])
    return GenerationJobRead(**values)


def _message_from_row(row: Any) -> ChatMessageRead:
    return ChatMessageRead(
        id=f"chat:{row['id']}",
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
        status=row["status"],
        evidence_summary=AskEvidenceSummary.model_validate_json(row["evidence_summary_json"])
        if row["evidence_summary_json"]
        else None,
        sources=[],
    )


def _chat_thread_from_row(row: Any) -> ChatThreadRead:
    return ChatThreadRead(
        id=row["id"],
        title=row["title"],
        scope=json.loads(row["scope_json"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _normalize_thread_title(title: str) -> str:
    normalized = " ".join(title.split())
    if not normalized:
        raise ValueError("title must not be blank")
    return normalized[:MAX_THREAD_TITLE_LENGTH]


def _title_from_question(question: str) -> str:
    return _normalize_thread_title(question)


def _normalize_scope(scope: dict[str, Any] | None) -> dict[str, Any]:
    if scope is None or scope.get("mode") == "all":
        return dict(DEFAULT_SCOPE)
    if scope.get("mode") != "custom":
        raise ValueError("scope mode must be all or custom")
    note_ids = scope.get("note_ids")
    if not isinstance(note_ids, list):
        raise ValueError("custom scope note_ids must be a list")
    normalized: list[int] = []
    seen: set[int] = set()
    for note_id in note_ids:
        if type(note_id) is not int or note_id < 1:
            raise ValueError("note_ids must contain positive integers")
        if note_id not in seen:
            normalized.append(note_id)
            seen.add(note_id)
    return {"mode": "custom", "note_ids": normalized}


def _scope_json(scope: dict[str, Any]) -> str:
    return json.dumps(scope, separators=(",", ":"))


def _thread_user_message_count(connection: Any, user_id: str, thread_id: int) -> int:
    return int(
        connection.execute(
            "SELECT COUNT(*) FROM chat_messages WHERE user_id = ? AND thread_id = ? AND role = 'user'",
            (user_id, thread_id),
        ).fetchone()[0]
    )


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")
