import json
import sqlite3
from contextlib import closing
from pathlib import Path

from mapping_memory.fts import backfill_notes_fts_if_empty, init_notes_fts


def connect_db(sqlite_path: Path) -> sqlite3.Connection:
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(sqlite_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db(sqlite_path: Path) -> None:
    with closing(connect_db(sqlite_path)) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                slug TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_text TEXT NOT NULL,
                ai_title TEXT NOT NULL,
                short_summary TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                date_added TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                category_id INTEGER REFERENCES categories(id),
                markdown_path TEXT,
                needs_ai_organization INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        _migrate_notes_category_id(connection)
        _migrate_notes_markdown_path(connection)
        _migrate_notes_ai_organization(connection)
        init_notes_fts(connection)
        backfill_notes_fts_if_empty(connection)
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_threads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                title TEXT NOT NULL,
                scope_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                thread_id INTEGER REFERENCES chat_threads(id) ON DELETE CASCADE,
                status TEXT,
                evidence_summary_json TEXT,
                sources_json TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        _migrate_chat_threads(connection)
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS memory_settings (
                user_id TEXT PRIMARY KEY,
                learning_enabled INTEGER NOT NULL DEFAULT 1
            )
            """
        )
        connection.commit()


def _migrate_notes_category_id(connection: sqlite3.Connection) -> None:
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(notes)").fetchall()}
    if "category_id" not in columns:
        connection.execute(
            "ALTER TABLE notes ADD COLUMN category_id INTEGER REFERENCES categories(id)"
        )


def _migrate_notes_markdown_path(connection: sqlite3.Connection) -> None:
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(notes)").fetchall()}
    if "markdown_path" not in columns:
        connection.execute("ALTER TABLE notes ADD COLUMN markdown_path TEXT")


def _migrate_notes_ai_organization(connection: sqlite3.Connection) -> None:
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(notes)").fetchall()}
    if "needs_ai_organization" not in columns:
        connection.execute(
            "ALTER TABLE notes ADD COLUMN needs_ai_organization INTEGER NOT NULL DEFAULT 0"
        )


def _migrate_chat_threads(connection: sqlite3.Connection) -> None:
    columns = {
        row["name"] for row in connection.execute("PRAGMA table_info(chat_messages)").fetchall()
    }
    if "thread_id" not in columns:
        connection.execute(
            """
            ALTER TABLE chat_messages
            ADD COLUMN thread_id INTEGER REFERENCES chat_threads(id) ON DELETE CASCADE
            """
        )

    user_rows = connection.execute(
        """
        SELECT user_id, MIN(created_at) AS created_at, MAX(created_at) AS updated_at
        FROM chat_messages
        WHERE thread_id IS NULL
        GROUP BY user_id
        """
    ).fetchall()
    for user_row in user_rows:
        user_id = user_row["user_id"]
        first_user_message = connection.execute(
            """
            SELECT content FROM chat_messages
            WHERE user_id = ? AND role = 'user' AND thread_id IS NULL
            ORDER BY id
            LIMIT 1
            """,
            (user_id,),
        ).fetchone()
        title = (
            _legacy_chat_title(first_user_message["content"])
            if first_user_message is not None
            else "Previous chat"
        )
        cursor = connection.execute(
            """
            INSERT INTO chat_threads (user_id, title, scope_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                user_id,
                title,
                json.dumps({"mode": "all"}, separators=(",", ":")),
                user_row["created_at"],
                user_row["updated_at"],
            ),
        )
        connection.execute(
            "UPDATE chat_messages SET thread_id = ? WHERE user_id = ? AND thread_id IS NULL",
            (cursor.lastrowid, user_id),
        )


def _legacy_chat_title(content: str) -> str:
    title = " ".join(content.split())
    if not title:
        return "Previous chat"
    return title[:120]
