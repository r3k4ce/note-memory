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
    ]
    assert create_sql is not None
    assert "AUTOINCREMENT" in create_sql[0].upper()


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
