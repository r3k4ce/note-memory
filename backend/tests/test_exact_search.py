import sqlite3
from pathlib import Path

from mapping_memory.db import init_db
from mapping_memory.fts import rebuild_notes_fts
from mapping_memory.notes import create_note, search_notes_exact, search_notes_exact_matches


def test_exact_search_finds_ticket_ids(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    note = create_note(
        sqlite_path,
        "Investigate ticket CD-30954 before publishing the map.",
        ai_title="Competition import issue",
        short_summary="Ticket CD-30954 needs source reconciliation.",
    )
    create_note(sqlite_path, "Unrelated mapping note")

    results = search_notes_exact(sqlite_path, "CD-30954")

    assert [result.id for result in results] == [note.id]


def test_exact_search_finds_source_names_case_insensitively(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    note = create_note(
        sqlite_path,
        "Live adapter source is FferjComBrLiveAR.",
        ai_title="FERJ live source",
        short_summary="FferjComBrLiveAR should be monitored.",
    )

    results = search_notes_exact(sqlite_path, "fferjcombrlivear")

    assert [result.id for result in results] == [note.id]


def test_exact_search_finds_tags(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    note = create_note(
        sqlite_path,
        "Track exact keyword coverage.",
        ai_title="Keyword coverage",
        short_summary="Exact search note.",
        tags=["competition-id", "retrieval"],
    )

    results = search_notes_exact(sqlite_path, "competition-id")

    assert [result.id for result in results] == [note.id]


def test_exact_search_match_includes_body_snippet(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    note = create_note(
        sqlite_path,
        (
            "Opening context that should not dominate the snippet. "
            "Investigate ticket CD-30954 before publishing the map. "
            "Trailing context explains the follow-up."
        ),
        ai_title="Competition import issue",
        short_summary="Ticket CD-30954 needs source reconciliation.",
    )

    results = search_notes_exact_matches(sqlite_path, "CD-30954")

    assert [result.note.id for result in results] == [note.id]
    assert results[0].matched_snippet is not None
    assert "Investigate ticket CD-30954 before publishing" in results[0].matched_snippet


def test_exact_search_match_includes_metadata_snippet_when_body_does_not_match(
    tmp_path: Path,
) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    note = create_note(
        sqlite_path,
        "Body text only mentions general mapping work.",
        ai_title="Competition import issue",
        short_summary="Ticket CD-30954 needs source reconciliation.",
        tags=["tickets"],
    )

    results = search_notes_exact_matches(sqlite_path, "CD-30954")

    assert [result.note.id for result in results] == [note.id]
    assert results[0].matched_snippet == "Ticket CD-30954 needs source reconciliation."


def test_exact_search_match_snippet_is_short(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    create_note(
        sqlite_path,
        (f"{'before ' * 80}CD-30954{' after' * 80}"),
    )

    results = search_notes_exact_matches(sqlite_path, "CD-30954")

    assert results[0].matched_snippet is not None
    assert len(results[0].matched_snippet) <= 240
    assert results[0].matched_snippet.startswith("...")
    assert results[0].matched_snippet.endswith("...")


def test_exact_search_match_has_null_snippet_without_literal_match(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    create_note(sqlite_path, "Ticket CD 30954 has a space.")

    results = search_notes_exact_matches(sqlite_path, "CD-30954")

    assert results == []


def test_exact_search_requires_literal_punctuation_match(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    create_note(sqlite_path, "Ticket CD 30954 has a space.")

    results = search_notes_exact(sqlite_path, "CD-30954")

    assert results == []


def test_note_creation_updates_fts(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)

    note = create_note(sqlite_path, "Newly created note mentions CD-30954.")

    with sqlite3.connect(sqlite_path) as connection:
        rowids = connection.execute(
            "SELECT rowid FROM notes_fts WHERE notes_fts MATCH ?",
            ('"CD-30954"',),
        ).fetchall()

    assert rowids == [(note.id,)]


def test_init_db_backfills_existing_notes_when_fts_is_new(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "legacy.sqlite"
    sqlite_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(sqlite_path) as connection:
        connection.execute(
            """
            CREATE TABLE notes (
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
        connection.execute(
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
                "Legacy note mentions FferjComBrLiveAR.",
                "Legacy source",
                "Legacy summary.",
                '["legacy-source"]',
                "2026-07-01T00:00:00+00:00",
                "2026-07-01T00:00:00+00:00",
            ),
        )
        connection.commit()

    init_db(sqlite_path)

    results = search_notes_exact(sqlite_path, "legacy-source")
    assert [result.ai_title for result in results] == ["Legacy source"]


def test_rebuild_notes_fts_replaces_existing_index(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "notes.sqlite"
    init_db(sqlite_path)
    note = create_note(sqlite_path, "Original searchable CD-30954.")

    with sqlite3.connect(sqlite_path) as connection:
        connection.execute(
            """
            UPDATE notes
            SET original_text = ?, ai_title = ?, short_summary = ?
            WHERE id = ?
            """,
            (
                "Updated searchable FferjComBrLiveAR.",
                "Updated source",
                "Updated source summary.",
                note.id,
            ),
        )
        rebuild_notes_fts(connection)
        connection.commit()

    assert search_notes_exact(sqlite_path, "CD-30954") == []
    assert [result.id for result in search_notes_exact(sqlite_path, "FferjComBrLiveAR")] == [
        note.id
    ]
