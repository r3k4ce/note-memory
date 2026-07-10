from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

from mapping_memory.db import connect_db
from mapping_memory.fts import rebuild_notes_fts
from mapping_memory.markdown_notes import parse_markdown_note
from mapping_memory.notes import (
    _fallback_title,
    create_category,
    create_note,
    list_categories,
    update_note,
)


def sync_markdown_vault(sqlite_path: Path, vault_path: Path) -> list[int]:
    vault_path.mkdir(parents=True, exist_ok=True)
    changed_note_ids = _delete_notes_missing_markdown_files(sqlite_path, vault_path)
    changed_note_ids.extend(_import_newer_markdown_files(sqlite_path, vault_path))
    return changed_note_ids


def _delete_notes_missing_markdown_files(sqlite_path: Path, vault_path: Path) -> list[int]:
    deleted_note_ids: list[int] = []
    with closing(connect_db(sqlite_path)) as connection:
        rows = connection.execute(
            """
            SELECT id, markdown_path
            FROM notes
            WHERE markdown_path IS NOT NULL
            ORDER BY id ASC
            """
        ).fetchall()
        for row in rows:
            if (vault_path / row["markdown_path"]).exists():
                continue

            connection.execute("DELETE FROM notes WHERE id = ?", (row["id"],))
            deleted_note_ids.append(row["id"])

        if deleted_note_ids:
            rebuild_notes_fts(connection)
        connection.commit()

    return deleted_note_ids


def _import_newer_markdown_files(sqlite_path: Path, vault_path: Path) -> list[int]:
    known_notes = _known_markdown_notes(sqlite_path)
    known_paths = set(known_notes)
    changed_note_ids: list[int] = []
    for markdown_path in sorted(vault_path.glob("*.md")):
        relative_path = markdown_path.name
        if relative_path not in known_paths:
            note_id = _import_new_markdown_file(sqlite_path, markdown_path)
            if note_id is not None:
                changed_note_ids.append(note_id)
            continue

        note_id, updated_at = known_notes[relative_path]
        file_updated_at = datetime.fromtimestamp(markdown_path.stat().st_mtime, tz=UTC)
        note_updated_at = datetime.fromisoformat(updated_at)
        if file_updated_at > note_updated_at:
            imported_note_id = _import_existing_markdown_file(sqlite_path, note_id, markdown_path)
            if imported_note_id is not None:
                changed_note_ids.append(imported_note_id)

    return changed_note_ids


def _known_markdown_notes(sqlite_path: Path) -> dict[str, tuple[int, str]]:
    with closing(connect_db(sqlite_path)) as connection:
        rows = connection.execute(
            """
            SELECT id, markdown_path, updated_at
            FROM notes
            WHERE markdown_path IS NOT NULL
            """
        ).fetchall()
    return {row["markdown_path"]: (row["id"], row["updated_at"]) for row in rows}


def _import_new_markdown_file(sqlite_path: Path, markdown_path: Path) -> int | None:
    parsed = parse_markdown_note(markdown_path.read_text())
    body = parsed.body
    if not body.strip():
        return None

    note = create_note(
        sqlite_path,
        body,
        ai_title=parsed.title or _fallback_title(body),
        short_summary=parsed.summary or body[:250],
        tags=parsed.tags,
        category_id=_category_id_for_name(sqlite_path, parsed.category),
        markdown_path=markdown_path.name,
    )
    return note.id


def _import_existing_markdown_file(
    sqlite_path: Path,
    note_id: int,
    markdown_path: Path,
) -> int | None:
    parsed = parse_markdown_note(markdown_path.read_text())
    body = parsed.body
    if not body.strip():
        return None

    note = update_note(
        sqlite_path,
        note_id,
        original_text=body,
        ai_title=parsed.title or _fallback_title(body),
        short_summary=parsed.summary or body[:250],
        tags=parsed.tags,
        category_id=_category_id_for_name(sqlite_path, parsed.category),
    )
    return note.id if note is not None else None


def _category_id_for_name(sqlite_path: Path, category_name: str) -> int | None:
    stripped_name = category_name.strip()
    if not stripped_name:
        return None

    for category in list_categories(sqlite_path):
        if category.name.lower() == stripped_name.lower():
            return category.id

    return create_category(sqlite_path, stripped_name).id
