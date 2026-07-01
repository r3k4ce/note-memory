import sqlite3
from datetime import datetime, tzinfo
from pathlib import Path

import pytest

from mapping_memory.db import init_db
from mapping_memory.notes import (
    create_note,
    get_note,
    list_notes,
    search_notes_exact,
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


def test_update_note_metadata_refreshes_exact_search(sqlite_path: Path) -> None:
    note = create_note(
        sqlite_path,
        "Stable original body.",
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
