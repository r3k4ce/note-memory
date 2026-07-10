import sqlite3

from fastapi.testclient import TestClient

from mapping_memory.db import init_db
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


def test_init_db_creates_chat_threads_table_and_migrates_legacy_messages(tmp_path) -> None:
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
        thread_columns = connection.execute("PRAGMA table_info(chat_threads)").fetchall()
        message_thread_column = connection.execute(
            "SELECT name FROM pragma_table_info('chat_messages') WHERE name = 'thread_id'"
        ).fetchone()
        threads = connection.execute(
            "SELECT user_id, title, scope_json FROM chat_threads ORDER BY user_id"
        ).fetchall()
        messages = connection.execute(
            """
            SELECT chat_messages.user_id, chat_threads.title
            FROM chat_messages
            JOIN chat_threads ON chat_threads.id = chat_messages.thread_id
            ORDER BY chat_messages.id
            """
        ).fetchall()

    assert [(column["name"], column["type"], column["notnull"]) for column in thread_columns] == [
        ("id", "INTEGER", 0),
        ("user_id", "TEXT", 1),
        ("title", "TEXT", 1),
        ("scope_json", "TEXT", 1),
        ("created_at", "TEXT", 1),
        ("updated_at", "TEXT", 1),
    ]
    assert tuple(message_thread_column) == ("thread_id",)
    assert [(row["user_id"], row["title"], row["scope_json"]) for row in threads] == [
        ("owner-a", "What did I save about launch?", '{"mode":"all"}'),
        ("owner-b", "Previous chat", '{"mode":"all"}'),
    ]
    assert [(row["user_id"], row["title"]) for row in messages] == [
        ("owner-a", "What did I save about launch?"),
        ("owner-b", "Previous chat"),
    ]


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
