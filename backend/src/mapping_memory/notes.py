import json
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from sqlite3 import Row

from mapping_memory.db import connect_db
from mapping_memory.fts import (
    build_exact_match_query,
    index_note_fts,
    rebuild_notes_fts,
    row_matches_literal,
)
from mapping_memory.schemas import NoteRead

UNTITLED_NOTE_TITLE = "Untitled mapping note"


def create_note(
    sqlite_path: Path,
    original_text: str,
    *,
    ai_title: str | None = None,
    short_summary: str | None = None,
    tags: list[str] | None = None,
) -> NoteRead:
    if not original_text.strip():
        raise ValueError("original_text must not be empty")

    timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()
    note_tags = tags if tags is not None else []
    tags_json = json.dumps(note_tags)
    note_title = ai_title if ai_title is not None else _fallback_title(original_text)
    note_summary = short_summary if short_summary is not None else original_text[:250]

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
                note_title,
                note_summary,
                tags_json,
                timestamp,
                timestamp,
            ),
        )
        note_id = cursor.lastrowid
        if note_id is None:
            raise RuntimeError("created note id was not returned")

        index_note_fts(
            connection,
            note_id=note_id,
            ai_title=note_title,
            short_summary=note_summary,
            tags=note_tags,
            original_text=original_text,
        )
        connection.commit()

    note = get_note(sqlite_path, note_id)
    if note is None:
        raise RuntimeError("created note could not be fetched")

    return note


def update_note_metadata(
    sqlite_path: Path,
    note_id: int,
    *,
    ai_title: str | None = None,
    short_summary: str | None = None,
    tags: list[str] | None = None,
) -> NoteRead | None:
    timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()

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

        current_note = _note_from_row(row)
        note_title = ai_title if ai_title is not None else current_note.ai_title
        note_summary = short_summary if short_summary is not None else current_note.short_summary
        note_tags = tags if tags is not None else current_note.tags

        connection.execute(
            """
            UPDATE notes
            SET ai_title = ?, short_summary = ?, tags_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (note_title, note_summary, json.dumps(note_tags), timestamp, note_id),
        )
        index_note_fts(
            connection,
            note_id=note_id,
            ai_title=note_title,
            short_summary=note_summary,
            tags=note_tags,
            original_text=current_note.original_text,
        )
        connection.commit()

    return get_note(sqlite_path, note_id)


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


def delete_note(sqlite_path: Path, note_id: int) -> bool:
    with closing(connect_db(sqlite_path)) as connection:
        cursor = connection.execute("DELETE FROM notes WHERE id = ?", (note_id,))
        if cursor.rowcount == 0:
            return False

        rebuild_notes_fts(connection)
        connection.commit()

    return True


def search_notes_exact(sqlite_path: Path, query: str, *, limit: int = 20) -> list[NoteRead]:
    stripped_query = query.strip()
    if not stripped_query or limit <= 0:
        return []

    with closing(connect_db(sqlite_path)) as connection:
        rows = connection.execute(
            """
            SELECT
                notes.id,
                notes.original_text,
                notes.ai_title,
                notes.short_summary,
                notes.tags_json,
                notes.date_added,
                notes.updated_at
            FROM notes_fts
            JOIN notes ON notes.id = notes_fts.rowid
            WHERE notes_fts MATCH ?
            ORDER BY bm25(notes_fts), notes.date_added DESC, notes.id DESC
            LIMIT ?
            """,
            (build_exact_match_query(stripped_query), limit * 5),
        ).fetchall()

    matching_rows = [row for row in rows if row_matches_literal(row, stripped_query)]
    return [_note_from_row(row) for row in matching_rows[:limit]]


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
