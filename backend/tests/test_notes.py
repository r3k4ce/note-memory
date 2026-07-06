import sqlite3
from datetime import datetime, tzinfo
from pathlib import Path

import pytest

from mapping_memory.db import init_db
from mapping_memory.notes import (
    create_note,
    delete_note,
    get_note,
    list_notes,
    search_notes_exact,
    sync_markdown_vault,
    update_note,
    update_note_metadata,
)


@pytest.fixture
def sqlite_path(tmp_path: Path) -> Path:
    path = tmp_path / "notes.sqlite"
    init_db(path)
    return path


def test_create_note_inserts_note_with_fallback_metadata(sqlite_path: Path) -> None:
    original_text = "My mapping note\nSecond line"

    note = create_note(sqlite_path, original_text)

    assert note.id > 0
    assert note.original_text == original_text
    assert note.ai_title == "My mapping note"
    assert note.short_summary == original_text[:250]
    assert note.tags == []
    assert note.date_added
    assert note.updated_at == note.date_added

    with sqlite3.connect(sqlite_path) as connection:
        tags_json = connection.execute(
            "SELECT tags_json FROM notes WHERE id = ?",
            (note.id,),
        ).fetchone()

    assert tags_json == ("[]",)


def test_create_note_persists_provided_metadata(sqlite_path: Path) -> None:
    original_text = "Raw note text\nwith exact spacing"

    note = create_note(
        sqlite_path,
        original_text,
        ai_title="Organized title",
        short_summary="Organized summary.",
        tags=["routing", "retrieval"],
    )

    assert note.original_text == original_text
    assert note.ai_title == "Organized title"
    assert note.short_summary == "Organized summary."
    assert note.tags == ["routing", "retrieval"]

    with sqlite3.connect(sqlite_path) as connection:
        tags_json = connection.execute(
            "SELECT tags_json FROM notes WHERE id = ?",
            (note.id,),
        ).fetchone()

    assert tags_json == ('["routing", "retrieval"]',)


def test_create_note_writes_markdown_file_to_vault(sqlite_path: Path, tmp_path: Path) -> None:
    vault_path = tmp_path / "vault"

    note = create_note(
        sqlite_path,
        "Raw note text\nwith exact spacing",
        ai_title="Organized title",
        short_summary="Organized summary.",
        tags=["routing", "retrieval"],
        vault_path=vault_path,
    )

    note_path = vault_path / f"organized-title-{note.id}.md"
    assert note_path.read_text() == (
        "---\n"
        "title: Organized title\n"
        "summary: Organized summary.\n"
        "tags:\n"
        "- routing\n"
        "- retrieval\n"
        "category: ''\n"
        "---\n"
        "\n"
        "Raw note text\n"
        "with exact spacing"
    )


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


def test_create_note_indexes_note_for_exact_search(sqlite_path: Path) -> None:
    note = create_note(
        sqlite_path,
        "Created note mentions source FferjComBrLiveAR.",
        tags=["source-name"],
    )

    results = search_notes_exact(sqlite_path, "FferjComBrLiveAR")

    assert [result.id for result in results] == [note.id]


def test_get_note_returns_created_note(sqlite_path: Path) -> None:
    created_note = create_note(sqlite_path, "A note to fetch")

    fetched_note = get_note(sqlite_path, created_note.id)

    assert fetched_note == created_note


def test_get_note_returns_none_for_missing_id(sqlite_path: Path) -> None:
    assert get_note(sqlite_path, 999999) is None


def test_list_notes_returns_newest_first(sqlite_path: Path) -> None:
    older_note = create_note(sqlite_path, "Older note")
    newer_note = create_note(sqlite_path, "Newer note")

    notes = list_notes(sqlite_path)

    assert [note.id for note in notes] == [newer_note.id, older_note.id]


def test_delete_note_removes_existing_note_from_sqlite_and_fts(sqlite_path: Path) -> None:
    note = create_note(sqlite_path, "Searchable delete note CD-30954.")

    deleted = delete_note(sqlite_path, note.id)

    assert deleted is True
    assert get_note(sqlite_path, note.id) is None
    assert note.id not in [listed_note.id for listed_note in list_notes(sqlite_path)]
    assert search_notes_exact(sqlite_path, "CD-30954") == []


def test_delete_note_rebuilds_fts_for_existing_note(
    sqlite_path: Path,
    monkeypatch,
) -> None:
    note = create_note(sqlite_path, "FTS rebuild delete note")
    calls: list[object] = []

    def rebuild_notes_fts(connection: object) -> None:
        calls.append(connection)

    monkeypatch.setattr("mapping_memory.notes.rebuild_notes_fts", rebuild_notes_fts)

    assert delete_note(sqlite_path, note.id) is True
    assert len(calls) == 1


def test_delete_note_rolls_back_sqlite_when_markdown_delete_fails(
    sqlite_path: Path,
    tmp_path: Path,
    monkeypatch,
) -> None:
    note = create_note(
        sqlite_path,
        "Searchable delete rollback note CD-30954.",
        vault_path=tmp_path / "vault",
    )

    def delete_markdown_note(*args, **kwargs) -> None:
        raise OSError("permission denied")

    monkeypatch.setattr("mapping_memory.notes.delete_markdown_note", delete_markdown_note)

    with pytest.raises(OSError, match="permission denied"):
        delete_note(sqlite_path, note.id, vault_path=tmp_path / "vault")

    assert get_note(sqlite_path, note.id) is not None
    assert [result.id for result in search_notes_exact(sqlite_path, "CD-30954")] == [note.id]


def test_delete_note_returns_false_for_missing_note(sqlite_path: Path) -> None:
    assert delete_note(sqlite_path, 999999) is False


def test_update_note_metadata_preserves_original_text_and_updates_fields(
    sqlite_path: Path,
    monkeypatch,
) -> None:
    created_note = create_note(
        sqlite_path,
        "Original note text",
        ai_title="Old title",
        short_summary="Old summary.",
        tags=["old"],
    )

    class FakeDateTime:
        @classmethod
        def now(cls, tz: tzinfo | None) -> datetime:
            return datetime(2099, 1, 2, 3, 4, 5, tzinfo=tz)

    monkeypatch.setattr("mapping_memory.notes.datetime", FakeDateTime)

    updated_note = update_note_metadata(
        sqlite_path,
        created_note.id,
        ai_title="New title",
        short_summary="New summary.",
        tags=["new", "tags"],
    )

    assert updated_note is not None
    assert updated_note.id == created_note.id
    assert updated_note.original_text == "Original note text"
    assert updated_note.ai_title == "New title"
    assert updated_note.short_summary == "New summary."
    assert updated_note.tags == ["new", "tags"]
    assert updated_note.date_added == created_note.date_added
    assert updated_note.updated_at == "2099-01-02T03:04:05+00:00"


def test_update_note_can_update_only_original_text(sqlite_path: Path) -> None:
    created_note = create_note(
        sqlite_path,
        "Original note text",
        ai_title="Stable title",
        short_summary="Stable summary.",
        tags=["stable"],
    )

    updated_note = update_note(
        sqlite_path,
        created_note.id,
        original_text="Updated note body\nwith preserved metadata",
    )
    fetched_note = get_note(sqlite_path, created_note.id)

    assert updated_note is not None
    assert updated_note.id == created_note.id
    assert updated_note.original_text == "Updated note body\nwith preserved metadata"
    assert updated_note.ai_title == "Stable title"
    assert updated_note.short_summary == "Stable summary."
    assert updated_note.tags == ["stable"]
    assert updated_note.category is None
    assert updated_note.date_added == created_note.date_added
    assert updated_note.updated_at >= created_note.updated_at
    assert fetched_note == updated_note


def test_update_note_renames_markdown_file_when_title_changes(
    sqlite_path: Path,
    tmp_path: Path,
) -> None:
    vault_path = tmp_path / "vault"
    created_note = create_note(
        sqlite_path,
        "Original note text",
        ai_title="Old title",
        short_summary="Old summary.",
        tags=["old"],
        vault_path=vault_path,
    )
    old_path = vault_path / f"old-title-{created_note.id}.md"

    updated_note = update_note(
        sqlite_path,
        created_note.id,
        ai_title="New title",
        short_summary="New summary.",
        tags=["new"],
        vault_path=vault_path,
    )

    assert updated_note is not None
    assert not old_path.exists()
    new_path = vault_path / f"new-title-{created_note.id}.md"
    assert new_path.is_file()
    assert "title: New title\n" in new_path.read_text()


def test_update_note_refreshes_exact_search_for_updated_body(sqlite_path: Path) -> None:
    note = create_note(
        sqlite_path,
        "Original body contains oldbodyonly.",
        ai_title="Stable title",
        short_summary="Stable summary.",
        tags=["stable"],
    )

    updated_note = update_note(
        sqlite_path,
        note.id,
        original_text="Updated body contains newbodyonly.",
    )

    assert updated_note is not None
    assert [result.id for result in search_notes_exact(sqlite_path, "newbodyonly")] == [note.id]
    assert search_notes_exact(sqlite_path, "oldbodyonly") == []


def test_update_note_metadata_refreshes_exact_search(sqlite_path: Path) -> None:
    note = create_note(
        sqlite_path,
        "Stable original body stablebodyonly.",
        ai_title="Old metadata oldonly",
        short_summary="Old summary.",
        tags=["oldtag"],
    )

    updated_note = update_note_metadata(
        sqlite_path,
        note.id,
        ai_title="New metadata newonly",
        short_summary="New summary.",
        tags=["newtag"],
    )

    assert updated_note is not None
    assert [result.id for result in search_notes_exact(sqlite_path, "stablebodyonly")] == [note.id]
    assert [result.id for result in search_notes_exact(sqlite_path, "newonly")] == [note.id]
    assert [result.id for result in search_notes_exact(sqlite_path, "newtag")] == [note.id]
    assert search_notes_exact(sqlite_path, "oldonly") == []
    assert search_notes_exact(sqlite_path, "oldtag") == []


def test_create_note_preserves_original_text_exactly(sqlite_path: Path) -> None:
    original_text = "  Leading spaces\n\n\tTabbed line  \nTrailing newline\n"

    created_note = create_note(sqlite_path, original_text)
    fetched_note = get_note(sqlite_path, created_note.id)

    assert fetched_note is not None
    assert fetched_note.original_text == original_text


def test_create_note_uses_first_nonblank_line_for_title(sqlite_path: Path) -> None:
    note = create_note(sqlite_path, "\n  Useful title  \nBody")

    assert note.ai_title == "Useful title"


def test_create_note_rejects_whitespace_only_text(sqlite_path: Path) -> None:
    with pytest.raises(ValueError, match="original_text must not be empty"):
        create_note(sqlite_path, " \n\t ")


def test_create_category_persists_trimmed_name_and_slug(sqlite_path: Path) -> None:
    from mapping_memory.notes import create_category, list_categories

    category = create_category(sqlite_path, "  Work Notes  ")

    assert category.id > 0
    assert category.name == "Work Notes"
    assert category.slug == "work-notes"
    assert category.created_at
    assert category.updated_at == category.created_at
    assert list_categories(sqlite_path) == [category]


def test_update_category_renames_category_and_refreshes_note_reads(sqlite_path: Path) -> None:
    from mapping_memory.notes import create_category, get_note, update_category

    category = create_category(sqlite_path, "Work")
    note = create_note(sqlite_path, "Category rename note", category_id=category.id)

    updated = update_category(sqlite_path, category.id, " Projects ")

    assert updated is not None
    assert updated.id == category.id
    assert updated.name == "Projects"
    assert updated.slug == "projects"
    assert updated.updated_at >= category.updated_at
    fetched_note = get_note(sqlite_path, note.id)
    assert fetched_note is not None
    assert fetched_note.category == updated


def test_update_category_rejects_duplicate_name(sqlite_path: Path) -> None:
    from mapping_memory.notes import CategoryAlreadyExistsError, create_category, update_category

    category = create_category(sqlite_path, "Work")
    create_category(sqlite_path, "Personal")

    with pytest.raises(CategoryAlreadyExistsError, match="Category already exists"):
        update_category(sqlite_path, category.id, " personal ")


def test_delete_category_uncategorizes_notes_and_keeps_fts(sqlite_path: Path) -> None:
    from mapping_memory.notes import create_category, delete_category, list_categories

    category = create_category(sqlite_path, "Work")
    uncategorized_note = create_note(
        sqlite_path, "Work note with categoryonlytoken", category_id=category.id
    )
    kept_note = create_note(sqlite_path, "Loose categoryonlytoken note")

    affected_note_ids = delete_category(sqlite_path, category.id)

    assert affected_note_ids == [uncategorized_note.id]
    assert list_categories(sqlite_path) == []
    fetched_uncategorized_note = get_note(sqlite_path, uncategorized_note.id)
    assert fetched_uncategorized_note is not None
    assert fetched_uncategorized_note.category is None
    assert get_note(sqlite_path, kept_note.id) is not None
    assert {note.id for note in search_notes_exact(sqlite_path, "categoryonlytoken")} == {
        uncategorized_note.id,
        kept_note.id,
    }


def test_create_note_can_attach_category(sqlite_path: Path) -> None:
    from mapping_memory.notes import create_category

    category = create_category(sqlite_path, "Projects")

    note = create_note(sqlite_path, "Project note", category_id=category.id)

    assert note.category == category
    assert get_note(sqlite_path, note.id) == note


def test_list_notes_can_filter_by_category(sqlite_path: Path) -> None:
    from mapping_memory.notes import create_category

    category = create_category(sqlite_path, "Projects")
    included = create_note(sqlite_path, "Project note", category_id=category.id)
    create_note(sqlite_path, "Uncategorized note")

    notes = list_notes(sqlite_path, category_id=category.id)

    assert [note.id for note in notes] == [included.id]


def test_update_note_metadata_can_change_and_clear_category(sqlite_path: Path) -> None:
    from mapping_memory.notes import create_category

    category = create_category(sqlite_path, "Projects")
    note = create_note(sqlite_path, "Project note")

    categorized = update_note_metadata(sqlite_path, note.id, category_id=category.id)
    cleared = update_note_metadata(sqlite_path, note.id, category_id=None)

    assert categorized is not None
    assert categorized.category == category
    assert cleared is not None
    assert cleared.category is None
