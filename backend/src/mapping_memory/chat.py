import json
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from mapping_memory.db import connect_db
from mapping_memory.schemas import (
    AskEvidenceSummary,
    AskResponse,
    AskSource,
    ChatMessageRead,
    ChatThreadRead,
)

DEFAULT_THREAD_TITLE = "Untitled chat"
DEFAULT_SCOPE = {"mode": "all"}
MAX_THREAD_TITLE_LENGTH = 120


def create_chat_thread(
    sqlite_path: Path,
    user_id: str,
    *,
    title: str | None = None,
    scope: dict[str, Any] | None = None,
) -> ChatThreadRead:
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    normalized_title = _normalize_thread_title(title if title is not None else DEFAULT_THREAD_TITLE)
    normalized_scope = _normalize_scope(scope)
    with closing(connect_db(sqlite_path)) as connection:
        cursor = connection.execute(
            """
            INSERT INTO chat_threads (user_id, title, scope_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (user_id, normalized_title, _scope_json(normalized_scope), now, now),
        )
        connection.commit()
        thread_id = cursor.lastrowid

    if thread_id is None:
        raise RuntimeError("created chat thread did not return an id")
    thread = get_chat_thread(sqlite_path, user_id, thread_id)
    if thread is None:
        raise RuntimeError("created chat thread could not be read")
    return thread


def list_chat_threads(sqlite_path: Path, user_id: str) -> list[ChatThreadRead]:
    with closing(connect_db(sqlite_path)) as connection:
        rows = connection.execute(
            """
            SELECT * FROM chat_threads
            WHERE user_id = ?
            ORDER BY updated_at DESC, id DESC
            """,
            (user_id,),
        ).fetchall()
    return [_chat_thread_from_row(row) for row in rows]


def get_chat_thread(sqlite_path: Path, user_id: str, thread_id: int) -> ChatThreadRead | None:
    with closing(connect_db(sqlite_path)) as connection:
        row = connection.execute(
            "SELECT * FROM chat_threads WHERE user_id = ? AND id = ?",
            (user_id, thread_id),
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

    updated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    updates.append("updated_at = ?")
    values.append(updated_at)
    values.extend([user_id, thread_id])

    with closing(connect_db(sqlite_path)) as connection:
        cursor = connection.execute(
            f"UPDATE chat_threads SET {', '.join(updates)} WHERE user_id = ? AND id = ?",
            values,
        )
        connection.commit()
    if cursor.rowcount == 0:
        return None
    return get_chat_thread(sqlite_path, user_id, thread_id)


def delete_chat_thread(sqlite_path: Path, user_id: str, thread_id: int) -> bool:
    with closing(connect_db(sqlite_path)) as connection:
        cursor = connection.execute(
            "DELETE FROM chat_threads WHERE user_id = ? AND id = ?",
            (user_id, thread_id),
        )
        connection.commit()
    return cursor.rowcount > 0


def append_chat_turn(
    sqlite_path: Path,
    user_id: str,
    question: str,
    response: AskResponse,
    *,
    thread_id: int | None = None,
) -> None:
    created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with closing(connect_db(sqlite_path)) as connection:
        if thread_id is None:
            latest_thread = connection.execute(
                """
                SELECT * FROM chat_threads
                WHERE user_id = ?
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                """,
                (user_id,),
            ).fetchone()
            if latest_thread is None:
                cursor = connection.execute(
                    """
                    INSERT INTO chat_threads (user_id, title, scope_json, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        DEFAULT_THREAD_TITLE,
                        _scope_json(DEFAULT_SCOPE),
                        created_at,
                        created_at,
                    ),
                )
                thread_id = cursor.lastrowid
                if thread_id is None:
                    raise RuntimeError("created chat thread did not return an id")
                title = DEFAULT_THREAD_TITLE
                existing_user_messages = 0
            else:
                thread_id = int(latest_thread["id"])
                title = latest_thread["title"]
                existing_user_messages = _thread_user_message_count(connection, user_id, thread_id)
        else:
            requested_thread_id = thread_id
            thread = connection.execute(
                "SELECT * FROM chat_threads WHERE user_id = ? AND id = ?",
                (user_id, requested_thread_id),
            ).fetchone()
            if thread is None:
                raise ValueError("chat thread not found")
            thread_id = requested_thread_id
            title = thread["title"]
            existing_user_messages = _thread_user_message_count(connection, user_id, thread_id)

        connection.execute(
            """INSERT INTO chat_messages (user_id, thread_id, role, content, created_at)
               VALUES (?, ?, 'user', ?, ?)""",
            (user_id, thread_id, question, created_at),
        )
        connection.execute(
            """INSERT INTO chat_messages
               (
                   user_id, thread_id, role, content, status,
                   evidence_summary_json, sources_json, created_at
               )
               VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)""",
            (
                user_id,
                thread_id,
                response.answer,
                response.status,
                response.evidence_summary.model_dump_json(),
                json.dumps([source.model_dump(mode="json") for source in response.sources]),
                created_at,
            ),
        )
        next_title = (
            _title_from_question(question)
            if title == DEFAULT_THREAD_TITLE and existing_user_messages == 0
            else title
        )
        connection.execute(
            "UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?",
            (next_title, created_at, thread_id),
        )
        connection.commit()


def list_chat_messages(
    sqlite_path: Path, user_id: str, thread_id: int | None = None
) -> list[ChatMessageRead]:
    with closing(connect_db(sqlite_path)) as connection:
        if thread_id is None:
            latest_thread = connection.execute(
                """
                SELECT id FROM chat_threads
                WHERE user_id = ?
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                """,
                (user_id,),
            ).fetchone()
            if latest_thread is None:
                return []
            thread_id = latest_thread["id"]

        rows = connection.execute(
            "SELECT * FROM chat_messages WHERE user_id = ? AND thread_id = ? ORDER BY id",
            (user_id, thread_id),
        ).fetchall()
    return [
        ChatMessageRead(
            id=f"chat:{row['id']}",
            role=row["role"],
            content=row["content"],
            created_at=row["created_at"],
            status=row["status"],
            evidence_summary=(
                AskEvidenceSummary.model_validate_json(row["evidence_summary_json"])
                if row["evidence_summary_json"]
                else None
            ),
            sources=(
                [AskSource.model_validate(item) for item in json.loads(row["sources_json"])]
                if row["sources_json"]
                else []
            ),
        )
        for row in rows
    ]


def clear_chat(sqlite_path: Path, user_id: str) -> None:
    with closing(connect_db(sqlite_path)) as connection:
        latest_thread = connection.execute(
            """
            SELECT id FROM chat_threads
            WHERE user_id = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        if latest_thread is not None:
            connection.execute(
                "DELETE FROM chat_messages WHERE user_id = ? AND thread_id = ?",
                (user_id, latest_thread["id"]),
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


def _chat_thread_from_row(row: Any) -> ChatThreadRead:
    return ChatThreadRead(
        id=row["id"],
        title=row["title"],
        scope=json.loads(row["scope_json"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _normalize_thread_title(title: str) -> str:
    stripped_title = " ".join(title.split())
    if not stripped_title:
        raise ValueError("title must not be blank")
    return stripped_title[:MAX_THREAD_TITLE_LENGTH]


def _title_from_question(question: str) -> str:
    return _normalize_thread_title(question)


def _normalize_scope(scope: dict[str, Any] | None) -> dict[str, Any]:
    if scope is None:
        return dict(DEFAULT_SCOPE)
    if scope.get("mode") == "all":
        return dict(DEFAULT_SCOPE)
    if scope.get("mode") != "custom":
        raise ValueError("scope mode must be all or custom")

    note_ids = scope.get("note_ids")
    if not isinstance(note_ids, list) or not note_ids:
        raise ValueError("custom scope must include note_ids")

    normalized_note_ids: list[int] = []
    seen_note_ids: set[int] = set()
    for note_id in note_ids:
        if type(note_id) is not int or note_id < 1:
            raise ValueError("note_ids must contain positive integers")
        if note_id in seen_note_ids:
            continue
        normalized_note_ids.append(note_id)
        seen_note_ids.add(note_id)

    return {"mode": "custom", "note_ids": normalized_note_ids}


def _scope_json(scope: dict[str, Any]) -> str:
    return json.dumps(scope, separators=(",", ":"))


def _thread_user_message_count(connection: Any, user_id: str, thread_id: int) -> int:
    row = connection.execute(
        """
        SELECT COUNT(*) AS message_count
        FROM chat_messages
        WHERE user_id = ? AND thread_id = ? AND role = 'user'
        """,
        (user_id, thread_id),
    ).fetchone()
    return int(row["message_count"])
