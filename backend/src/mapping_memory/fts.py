import json
import sqlite3
from collections.abc import Sequence
from sqlite3 import Row

FTS_TABLE = "notes_fts"


def init_notes_fts(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
            ai_title,
            short_summary,
            tags_text,
            original_text,
            content='notes',
            content_rowid='id'
        )
        """
    )


def index_note_fts(
    connection: sqlite3.Connection,
    *,
    note_id: int,
    ai_title: str,
    short_summary: str,
    tags: Sequence[str],
    original_text: str,
) -> None:
    if note_is_indexed(connection, note_id):
        rebuild_notes_fts(connection)
        return

    insert_note_fts(
        connection,
        note_id=note_id,
        ai_title=ai_title,
        short_summary=short_summary,
        tags=tags,
        original_text=original_text,
    )


def rebuild_notes_fts(connection: sqlite3.Connection) -> None:
    connection.execute("INSERT INTO notes_fts(notes_fts) VALUES('delete-all')")
    rows = connection.execute(
        """
        SELECT id, ai_title, short_summary, tags_json, original_text
        FROM notes
        ORDER BY id ASC
        """
    ).fetchall()
    for note_id, ai_title, short_summary, tags_json, original_text in rows:
        insert_note_fts(
            connection,
            note_id=note_id,
            ai_title=ai_title,
            short_summary=short_summary,
            tags=tags_from_json(tags_json),
            original_text=original_text,
        )


def backfill_notes_fts_if_empty(connection: sqlite3.Connection) -> None:
    note_count = connection.execute("SELECT count(*) FROM notes").fetchone()[0]
    indexed_count = connection.execute("SELECT count(*) FROM notes_fts_docsize").fetchone()[0]
    if note_count > 0 and indexed_count == 0:
        rebuild_notes_fts(connection)


def build_exact_match_query(query: str) -> str:
    escaped_query = query.replace('"', '""')
    return f'"{escaped_query}"'


def row_matches_literal(row: Row, query: str) -> bool:
    needle = query.casefold()
    haystacks = [
        row["ai_title"],
        row["short_summary"],
        tags_to_text(tags_from_json(row["tags_json"])),
        row["original_text"],
    ]
    return any(needle in haystack.casefold() for haystack in haystacks)


def note_is_indexed(connection: sqlite3.Connection, note_id: int) -> bool:
    row = connection.execute(
        "SELECT 1 FROM notes_fts_docsize WHERE id = ?",
        (note_id,),
    ).fetchone()
    return row is not None


def insert_note_fts(
    connection: sqlite3.Connection,
    *,
    note_id: int,
    ai_title: str,
    short_summary: str,
    tags: Sequence[str],
    original_text: str,
) -> None:
    connection.execute(
        """
        INSERT INTO notes_fts(rowid, ai_title, short_summary, tags_text, original_text)
        VALUES (?, ?, ?, ?, ?)
        """,
        (note_id, ai_title, short_summary, tags_to_text(tags), original_text),
    )


def tags_from_json(tags_json: str) -> list[str]:
    tags = json.loads(tags_json)
    if not isinstance(tags, list):
        return []

    return [tag for tag in tags if isinstance(tag, str)]


def tags_to_text(tags: Sequence[str]) -> str:
    return " ".join(tags)
