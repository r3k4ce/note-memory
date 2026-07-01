import json
import re
import sqlite3
import unicodedata
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from sqlite3 import Row

from mapping_memory.category_scope import CategoryScope, make_category_scope
from mapping_memory.db import connect_db
from mapping_memory.fts import (
    build_exact_match_query,
    index_note_fts,
    rebuild_notes_fts,
    row_matches_literal,
)
from mapping_memory.schemas import CategoryRead, NoteRead

UNTITLED_NOTE_TITLE = "Untitled note"


class CategoryAlreadyExistsError(ValueError):
    """Raised when a category name conflicts with an existing category."""


class CategoryNotFoundError(ValueError):
    """Raised when a note references a missing category."""


class _Unset:
    pass


_UNSET = _Unset()


def create_category(sqlite_path: Path, name: str) -> CategoryRead:
    category_name = name.strip()
    if not category_name:
        raise ValueError("name must not be blank")

    timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()
    with closing(connect_db(sqlite_path)) as connection:
        if _category_name_exists(connection, category_name):
            raise CategoryAlreadyExistsError("Category already exists")

        slug = _unique_category_slug(connection, _slugify(category_name))
        cursor = connection.execute(
            """
            INSERT INTO categories (name, slug, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (category_name, slug, timestamp, timestamp),
        )
        category_id = cursor.lastrowid
        if category_id is None:
            raise RuntimeError("created category id was not returned")

        connection.commit()

    category = get_category(sqlite_path, category_id)
    if category is None:
        raise RuntimeError("created category could not be fetched")

    return category


def get_category(sqlite_path: Path, category_id: int) -> CategoryRead | None:
    with closing(connect_db(sqlite_path)) as connection:
        row = connection.execute(
            """
            SELECT id, name, slug, created_at, updated_at
            FROM categories
            WHERE id = ?
            """,
            (category_id,),
        ).fetchone()

    if row is None:
        return None

    return _category_from_row(row)


def list_categories(sqlite_path: Path) -> list[CategoryRead]:
    with closing(connect_db(sqlite_path)) as connection:
        rows = connection.execute(
            """
            SELECT id, name, slug, created_at, updated_at
            FROM categories
            ORDER BY name COLLATE NOCASE ASC, id ASC
            """
        ).fetchall()

    return [_category_from_row(row) for row in rows]


def create_note(
    sqlite_path: Path,
    original_text: str,
    *,
    ai_title: str | None = None,
    short_summary: str | None = None,
    tags: list[str] | None = None,
    category_id: int | None = None,
) -> NoteRead:
    if not original_text.strip():
        raise ValueError("original_text must not be empty")

    timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()
    note_tags = tags if tags is not None else []
    tags_json = json.dumps(note_tags)
    note_title = ai_title if ai_title is not None else _fallback_title(original_text)
    note_summary = short_summary if short_summary is not None else original_text[:250]

    with closing(connect_db(sqlite_path)) as connection:
        _ensure_category_exists(connection, category_id)
        cursor = connection.execute(
            """
            INSERT INTO notes (
                original_text,
                ai_title,
                short_summary,
                tags_json,
                date_added,
                updated_at,
                category_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                original_text,
                note_title,
                note_summary,
                tags_json,
                timestamp,
                timestamp,
                category_id,
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
    category_id: int | None | _Unset = _UNSET,
) -> NoteRead | None:
    timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()

    with closing(connect_db(sqlite_path)) as connection:
        row = connection.execute(
            f"""
            SELECT {_note_select_columns()}
            FROM notes
            LEFT JOIN categories ON categories.id = notes.category_id
            WHERE notes.id = ?
            """,
            (note_id,),
        ).fetchone()
        if row is None:
            return None

        current_note = _note_from_row(row)
        note_title = ai_title if ai_title is not None else current_note.ai_title
        note_summary = short_summary if short_summary is not None else current_note.short_summary
        note_tags = tags if tags is not None else current_note.tags
        note_category_id = row["note_category_id"] if category_id is _UNSET else category_id
        if not isinstance(category_id, _Unset):
            _ensure_category_exists(connection, category_id)

        connection.execute(
            """
            UPDATE notes
            SET ai_title = ?, short_summary = ?, tags_json = ?, updated_at = ?, category_id = ?
            WHERE id = ?
            """,
            (note_title, note_summary, json.dumps(note_tags), timestamp, note_category_id, note_id),
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
            f"""
            SELECT {_note_select_columns()}
            FROM notes
            LEFT JOIN categories ON categories.id = notes.category_id
            WHERE notes.id = ?
            """,
            (note_id,),
        ).fetchone()

    if row is None:
        return None

    return _note_from_row(row)


def list_notes(
    sqlite_path: Path,
    *,
    category_id: int | None = None,
    uncategorized: bool = False,
) -> list[NoteRead]:
    scope = make_category_scope(category_id=category_id, uncategorized=uncategorized)
    with closing(connect_db(sqlite_path)) as connection:
        if scope.category_id is not None:
            _ensure_category_exists(connection, scope.category_id)
            rows = connection.execute(
                f"""
                SELECT {_note_select_columns()}
                FROM notes
                LEFT JOIN categories ON categories.id = notes.category_id
                WHERE notes.category_id = ?
                ORDER BY notes.date_added DESC, notes.id DESC
                """,
                (scope.category_id,),
            ).fetchall()
        elif scope.uncategorized:
            rows = connection.execute(
                f"""
                SELECT {_note_select_columns()}
                FROM notes
                LEFT JOIN categories ON categories.id = notes.category_id
                WHERE notes.category_id IS NULL
                ORDER BY notes.date_added DESC, notes.id DESC
                """
            ).fetchall()
        else:
            rows = connection.execute(
                f"""
                SELECT {_note_select_columns()}
                FROM notes
                LEFT JOIN categories ON categories.id = notes.category_id
                ORDER BY notes.date_added DESC, notes.id DESC
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


def search_notes_exact(
    sqlite_path: Path,
    query: str,
    *,
    limit: int = 20,
    category_scope: CategoryScope | None = None,
) -> list[NoteRead]:
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
    return [_note_from_row(row) for row in matching_rows[:limit]]


def _fallback_title(original_text: str) -> str:
    for line in original_text.splitlines():
        stripped_line = line.strip()
        if stripped_line:
            return stripped_line

    return UNTITLED_NOTE_TITLE


def _note_select_columns() -> str:
    return """
        notes.id,
        notes.original_text,
        notes.ai_title,
        notes.short_summary,
        notes.tags_json,
        notes.date_added,
        notes.updated_at,
        notes.category_id AS note_category_id,
        categories.id AS category_id,
        categories.name AS category_name,
        categories.slug AS category_slug,
        categories.created_at AS category_created_at,
        categories.updated_at AS category_updated_at
    """


def _note_from_row(row: Row) -> NoteRead:
    category = None
    if row["category_id"] is not None:
        category = CategoryRead(
            id=row["category_id"],
            name=row["category_name"],
            slug=row["category_slug"],
            created_at=row["category_created_at"],
            updated_at=row["category_updated_at"],
        )

    return NoteRead(
        id=row["id"],
        original_text=row["original_text"],
        ai_title=row["ai_title"],
        short_summary=row["short_summary"],
        tags=json.loads(row["tags_json"]),
        date_added=row["date_added"],
        updated_at=row["updated_at"],
        category=category,
    )


def _category_from_row(row: Row) -> CategoryRead:
    return CategoryRead(
        id=row["id"],
        name=row["name"],
        slug=row["slug"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _ensure_category_exists(connection: sqlite3.Connection, category_id: int | None) -> None:
    if category_id is None:
        return

    row = connection.execute("SELECT 1 FROM categories WHERE id = ?", (category_id,)).fetchone()
    if row is None:
        raise CategoryNotFoundError("Category not found")


def _category_name_exists(connection: sqlite3.Connection, name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM categories WHERE lower(name) = lower(?)",
        (name,),
    ).fetchone()
    return row is not None


def _unique_category_slug(connection: sqlite3.Connection, base_slug: str) -> str:
    slug = base_slug
    suffix = 2
    while _category_slug_exists(connection, slug):
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    return slug


def _category_slug_exists(connection: sqlite3.Connection, slug: str) -> bool:
    row = connection.execute("SELECT 1 FROM categories WHERE slug = ?", (slug,)).fetchone()
    return row is not None


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    if not slug:
        raise ValueError("name must contain letters or numbers")

    return slug
