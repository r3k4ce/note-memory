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
            CREATE TABLE IF NOT EXISTS notes (
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
        init_notes_fts(connection)
        backfill_notes_fts_if_empty(connection)
        connection.commit()
