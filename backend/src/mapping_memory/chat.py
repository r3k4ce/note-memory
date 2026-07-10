import json
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from mapping_memory.db import connect_db
from mapping_memory.schemas import (
    AskEvidenceSummary,
    AskResponse,
    AskSource,
    ChatMessageRead,
)


def append_chat_turn(sqlite_path: Path, user_id: str, question: str, response: AskResponse) -> None:
    created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    with closing(connect_db(sqlite_path)) as connection:
        connection.execute(
            """INSERT INTO chat_messages (user_id, role, content, created_at)
               VALUES (?, 'user', ?, ?)""",
            (user_id, question, created_at),
        )
        connection.execute(
            """INSERT INTO chat_messages
               (user_id, role, content, status, evidence_summary_json, sources_json, created_at)
               VALUES (?, 'assistant', ?, ?, ?, ?, ?)""",
            (
                user_id,
                response.answer,
                response.status,
                response.evidence_summary.model_dump_json(),
                json.dumps([source.model_dump(mode="json") for source in response.sources]),
                created_at,
            ),
        )
        connection.commit()


def list_chat_messages(sqlite_path: Path, user_id: str) -> list[ChatMessageRead]:
    with closing(connect_db(sqlite_path)) as connection:
        rows = connection.execute(
            "SELECT * FROM chat_messages WHERE user_id = ? ORDER BY id", (user_id,)
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
        connection.execute("DELETE FROM chat_messages WHERE user_id = ?", (user_id,))
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
