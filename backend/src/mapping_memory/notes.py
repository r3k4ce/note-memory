import json
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from sqlite3 import Row

from mapping_memory.db import connect_db
from mapping_memory.schemas import NoteRead

UNTITLED_NOTE_TITLE = "Untitled mapping note"


def create_note(sqlite_path: Path, original_text: str) -> NoteRead:
    if not original_text.strip():
        raise ValueError("original_text must not be empty")

    timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()
    tags_json = json.dumps([])

    with closing(connect_db(sqlite_path)) as connection:
        cursor = connection.execute(
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
                original_text,
                _fallback_title(original_text),
                original_text[:250],
                tags_json,
                timestamp,
                timestamp,
            ),
        )
        connection.commit()
        note_id = cursor.lastrowid

    if note_id is None:
        raise RuntimeError("created note id was not returned")

    note = get_note(sqlite_path, note_id)
    if note is None:
        raise RuntimeError("created note could not be fetched")

    return note


def get_note(sqlite_path: Path, note_id: int) -> NoteRead | None:
    with closing(connect_db(sqlite_path)) as connection:
        row = connection.execute(
            """
            SELECT id, original_text, ai_title, short_summary, tags_json, date_added, updated_at
            FROM notes
            WHERE id = ?
            """,
            (note_id,),
        ).fetchone()

    if row is None:
        return None

    return _note_from_row(row)


def list_notes(sqlite_path: Path) -> list[NoteRead]:
    with closing(connect_db(sqlite_path)) as connection:
        rows = connection.execute(
            """
            SELECT id, original_text, ai_title, short_summary, tags_json, date_added, updated_at
            FROM notes
            ORDER BY date_added DESC, id DESC
            """
        ).fetchall()

    return [_note_from_row(row) for row in rows]


def _fallback_title(original_text: str) -> str:
    for line in original_text.splitlines():
        stripped_line = line.strip()
        if stripped_line:
            return stripped_line

    return UNTITLED_NOTE_TITLE


def _note_from_row(row: Row) -> NoteRead:
    return NoteRead(
        id=row["id"],
        original_text=row["original_text"],
        ai_title=row["ai_title"],
        short_summary=row["short_summary"],
        tags=json.loads(row["tags_json"]),
        date_added=row["date_added"],
        updated_at=row["updated_at"],
    )
