import os
from datetime import datetime
from pathlib import Path

import pytest

from mapping_memory.db import init_db
from mapping_memory.exact_search import search_notes_exact
from mapping_memory.notes import create_note, get_note, list_notes
from mapping_memory.vault_sync import sync_markdown_vault


@pytest.fixture
def sqlite_path(tmp_path: Path) -> Path:
    path = tmp_path / "notes.sqlite"
    init_db(path)
    return path


def test_sync_markdown_vault_deletes_sqlite_note_when_markdown_file_is_missing(
    sqlite_path: Path,
    tmp_path: Path,
) -> None:
    vault_path = tmp_path / "vault"
    note = create_note(
        sqlite_path,
        "Missing vault file note CD-30954.",
        ai_title="Missing vault file",
        vault_path=vault_path,
    )
    markdown_path = vault_path / f"missing-vault-file-{note.id}.md"
    markdown_path.unlink()

    changed_note_ids = sync_markdown_vault(sqlite_path, vault_path)

    assert changed_note_ids == [note.id]
    assert get_note(sqlite_path, note.id) is None
    assert list_notes(sqlite_path) == []
    assert search_notes_exact(sqlite_path, "CD-30954") == []


def test_external_markdown_update_preserves_ai_organization_marker(
    sqlite_path: Path,
    tmp_path: Path,
) -> None:
    vault_path = tmp_path / "vault"
    note = create_note(
        sqlite_path,
        "Original body",
        ai_title="Original title",
        short_summary="Original summary.",
        vault_path=vault_path,
        needs_ai_organization=True,
    )
    markdown_path = vault_path / f"original-title-{note.id}.md"
    markdown_path.write_text(markdown_path.read_text().replace("Original body", "External edit"))
    future_timestamp = datetime.now().timestamp() + 10
    markdown_path.touch()
    os.utime(markdown_path, (future_timestamp, future_timestamp))

    sync_markdown_vault(sqlite_path, vault_path)

    updated = get_note(sqlite_path, note.id)
    assert updated is not None
    assert updated.original_text == "External edit"
    assert updated.needs_ai_organization is True


def test_new_markdown_import_defaults_ai_organization_marker_to_false(
    sqlite_path: Path,
    tmp_path: Path,
) -> None:
    vault_path = tmp_path / "vault"
    vault_path.mkdir()
    (vault_path / "external.md").write_text(
        "---\ntitle: External\nsummary: Imported.\ntags: []\ncategory: ''\n---\n\nExternal body"
    )

    changed_ids = sync_markdown_vault(sqlite_path, vault_path)

    imported = get_note(sqlite_path, changed_ids[0])
    assert imported is not None
    assert imported.needs_ai_organization is False
