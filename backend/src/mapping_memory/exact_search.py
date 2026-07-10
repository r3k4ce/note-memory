from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

from mapping_memory.category_scope import CategoryScope
from mapping_memory.db import connect_db
from mapping_memory.fts import (
    build_exact_match_query,
    literal_matched_snippet,
    row_matches_literal,
)
from mapping_memory.notes import _note_from_row, _note_select_columns
from mapping_memory.schemas import NoteRead


@dataclass(frozen=True)
class ExactSearchMatch:
    note: NoteRead
    matched_snippet: str | None


def search_notes_exact(
    sqlite_path: Path,
    query: str,
    *,
    limit: int = 20,
    category_scope: CategoryScope | None = None,
) -> list[NoteRead]:
    return [
        match.note
        for match in search_notes_exact_matches(
            sqlite_path,
            query,
            limit=limit,
            category_scope=category_scope,
        )
    ]


def search_notes_exact_matches(
    sqlite_path: Path,
    query: str,
    *,
    limit: int = 20,
    category_scope: CategoryScope | None = None,
) -> list[ExactSearchMatch]:
    stripped_query = query.strip()
    if not stripped_query or limit <= 0:
        return []

    scope = category_scope or CategoryScope()
    filters = ["notes_fts MATCH ?"]
    params: list[object] = [build_exact_match_query(stripped_query)]
    if scope.uncategorized:
        filters.append("notes.category_id IS NULL")
    elif scope.category_id is not None:
        filters.append("notes.category_id = ?")
        params.append(scope.category_id)
    params.append(limit * 5)

    with closing(connect_db(sqlite_path)) as connection:
        rows = connection.execute(
            f"""
            SELECT {_note_select_columns()}
            FROM notes_fts
            JOIN notes ON notes.id = notes_fts.rowid
            LEFT JOIN categories ON categories.id = notes.category_id
            WHERE {" AND ".join(filters)}
            ORDER BY bm25(notes_fts), notes.date_added DESC, notes.id DESC
            LIMIT ?
            """,
            tuple(params),
        ).fetchall()

    matching_rows = [row for row in rows if row_matches_literal(row, stripped_query)]
    return [
        ExactSearchMatch(
            note=_note_from_row(row),
            matched_snippet=literal_matched_snippet(row, stripped_query),
        )
        for row in matching_rows[:limit]
    ]
