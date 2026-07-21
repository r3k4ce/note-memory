# ruff: noqa: PT018
import sqlite3

import pytest
from fastapi.testclient import TestClient

from mapping_memory.db import init_db, reset_development_chat_data
from mapping_memory.main import create_app
from mapping_memory.settings import Settings


def test_init_db_creates_sqlite_file_and_notes_table(tmp_path) -> None:
    sqlite_path = tmp_path / "nested" / "mapping_memory.sqlite"

    init_db(sqlite_path)

    assert sqlite_path.parent.is_dir()
    assert sqlite_path.is_file()

    with sqlite3.connect(sqlite_path) as connection:
        table_name = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'"
        ).fetchone()

    assert table_name == ("notes",)


def test_init_db_creates_categories_table(tmp_path) -> None:
    sqlite_path = tmp_path / "mapping_memory.sqlite"

    init_db(sqlite_path)

    with sqlite3.connect(sqlite_path) as connection:
        columns = connection.execute("PRAGMA table_info(categories)").fetchall()
        create_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'categories'"
        ).fetchone()

    assert [(column[1], column[2], column[3], column[5]) for column in columns] == [
        ("id", "INTEGER", 0, 1),
        ("name", "TEXT", 1, 0),
        ("slug", "TEXT", 1, 0),
        ("created_at", "TEXT", 1, 0),
        ("updated_at", "TEXT", 1, 0),
    ]
    assert create_sql is not None
    assert "AUTOINCREMENT" in create_sql[0].upper()
    assert "UNIQUE" in create_sql[0].upper()


def test_init_db_creates_notes_fts_table(tmp_path) -> None:
    sqlite_path = tmp_path / "mapping_memory.sqlite"

    init_db(sqlite_path)

    with sqlite3.connect(sqlite_path) as connection:
        table_name = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes_fts'"
        ).fetchone()
        create_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notes_fts'"
        ).fetchone()
        docsize_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes_fts_docsize'"
        ).fetchone()

    assert table_name == ("notes_fts",)
    assert create_sql is not None
    assert "content='notes'" in create_sql[0]
    assert "content_rowid='id'" in create_sql[0]
    assert docsize_table == ("notes_fts_docsize",)


def test_init_db_replaces_legacy_chat_data_and_preserves_non_chat_tables(tmp_path) -> None:
    sqlite_path = tmp_path / "legacy-chat.sqlite"
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(sqlite_path) as connection:
        connection.execute(
            """
            CREATE TABLE chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL,
                status TEXT,
                evidence_summary_json TEXT,
                sources_json TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE categories (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE notes (
                id INTEGER PRIMARY KEY, original_text TEXT NOT NULL, ai_title TEXT NOT NULL,
                short_summary TEXT NOT NULL, tags_json TEXT NOT NULL, date_added TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute("INSERT INTO categories VALUES (1, 'Work', 'work', 'a', 'a')")
        connection.execute(
            "INSERT INTO notes VALUES (1, 'Note', 'Title', 'Summary', '[]', 'a', 'a')"
        )
        connection.execute(
            "CREATE TABLE memory_settings (user_id TEXT PRIMARY KEY, learning_enabled INTEGER)"
        )
        connection.execute("INSERT INTO memory_settings VALUES ('owner-a', 0)")
        connection.execute(
            """
            INSERT INTO chat_messages (user_id, role, content, created_at)
            VALUES ('owner-a', 'user', 'What did I save about launch?', '2026-07-01T00:00:00Z')
            """
        )
        connection.execute(
            """
            INSERT INTO chat_messages (user_id, role, content, created_at)
            VALUES ('owner-b', 'assistant', 'Answer', '2026-07-01T00:00:01Z')
            """
        )

    init_db(sqlite_path)

    with sqlite3.connect(sqlite_path) as connection:
        connection.row_factory = sqlite3.Row
        chat_counts = [
            connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("chat_threads", "chat_messages", "generation_jobs", "chat_turn_scopes")
        ]
        non_chat = connection.execute(
            "SELECT (SELECT COUNT(*) FROM notes), (SELECT COUNT(*) FROM categories), "
            "(SELECT learning_enabled FROM memory_settings WHERE user_id = 'owner-a')"
        ).fetchone()
        indexes = {
            row[1] for row in connection.execute("PRAGMA index_list(generation_jobs)").fetchall()
        }
        message_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_messages'"
        ).fetchone()[0]

    assert chat_counts == [0, 0, 0, 0]
    assert tuple(non_chat) == (1, 1, 0)
    assert "idx_generation_jobs_status_created" in indexes
    assert "completed" in message_sql and "answered" not in message_sql
    assert "sources_json" not in message_sql


def test_reset_development_chat_data_requires_explicit_permission(tmp_path) -> None:
    sqlite_path = tmp_path / "chat.sqlite"
    init_db(sqlite_path)

    with pytest.raises(ValueError, match="allowed"):
        reset_development_chat_data(sqlite_path, allowed=False)

    reset_development_chat_data(sqlite_path, allowed=True)


def test_notes_table_has_required_schema(tmp_path) -> None:
    sqlite_path = tmp_path / "mapping_memory.sqlite"

    init_db(sqlite_path)

    with sqlite3.connect(sqlite_path) as connection:
        columns = connection.execute("PRAGMA table_info(notes)").fetchall()
        create_sql = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'notes'"
        ).fetchone()

    assert [(column[1], column[2], column[3], column[5]) for column in columns] == [
        ("id", "INTEGER", 0, 1),
        ("original_text", "TEXT", 1, 0),
        ("ai_title", "TEXT", 1, 0),
        ("short_summary", "TEXT", 1, 0),
        ("tags_json", "TEXT", 1, 0),
        ("date_added", "TEXT", 1, 0),
        ("updated_at", "TEXT", 1, 0),
        ("category_id", "INTEGER", 0, 0),
        ("markdown_path", "TEXT", 0, 0),
        ("needs_ai_organization", "INTEGER", 1, 0),
    ]
    assert create_sql is not None
    assert "AUTOINCREMENT" in create_sql[0].upper()


def test_init_db_migrates_existing_notes_table_without_losing_notes(tmp_path) -> None:
    sqlite_path = tmp_path / "legacy.sqlite"

    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(sqlite_path) as connection:
        connection.execute(
            """
            CREATE TABLE notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_text TEXT NOT NULL,
                ai_title TEXT NOT NULL,
                short_summary TEXT NOT NULL,
                tags_json TEXT NOT NULL,
                date_added TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO notes (
                original_text,
                ai_title,
                short_summary,
                tags_json,
                date_added,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                "Legacy note",
                "Legacy title",
                "Legacy summary.",
                "[]",
                "2026-01-01T00:00:00+00:00",
                "2026-01-01T00:00:00+00:00",
            ),
        )

    init_db(sqlite_path)

    with sqlite3.connect(sqlite_path) as connection:
        category_column = connection.execute(
            "SELECT name FROM pragma_table_info('notes') WHERE name = 'category_id'"
        ).fetchone()
        legacy_note = connection.execute(
            "SELECT original_text, category_id FROM notes WHERE id = 1"
        ).fetchone()
        markdown_column = connection.execute(
            "SELECT name FROM pragma_table_info('notes') WHERE name = 'markdown_path'"
        ).fetchone()
        organization_column = connection.execute(
            'SELECT name, type, "notnull", dflt_value '
            "FROM pragma_table_info('notes') WHERE name = 'needs_ai_organization'"
        ).fetchone()

    assert category_column == ("category_id",)
    assert markdown_column == ("markdown_path",)
    assert organization_column == ("needs_ai_organization", "INTEGER", 1, "0")
    assert legacy_note == ("Legacy note", None)


def test_create_app_initializes_database_on_startup(tmp_path) -> None:
    sqlite_path = tmp_path / "startup.sqlite"
    app = create_app(Settings(sqlite_path=sqlite_path))

    with TestClient(app):
        pass

    assert sqlite_path.is_file()

    with sqlite3.connect(sqlite_path) as connection:
        table_name = connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notes'"
        ).fetchone()

    assert table_name == ("notes",)
