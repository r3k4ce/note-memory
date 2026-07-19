import logging
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from pydantic import SecretStr

from mapping_memory.chunking import create_retrieval_chunks
from mapping_memory.db import init_db
from mapping_memory.main import create_app
from mapping_memory.notes import create_note, get_note
from mapping_memory.provider_fingerprint import (
    chroma_fingerprint_path,
    expected_chroma_fingerprint,
    write_provider_fingerprint,
)
from mapping_memory.retrieval_index import reconcile_chroma_with_sqlite
from mapping_memory.settings import Settings
from mapping_memory.vector_store import build_chunk_id, build_chunk_metadata


def test_create_app_imports_markdown_file_from_vault(tmp_path: Path) -> None:
    vault_path = tmp_path / "vault"
    vault_path.mkdir()
    imported_path = vault_path / "external-note.md"
    imported_path.write_text(
        "---\n"
        "title: External note\n"
        "summary: External summary.\n"
        "tags:\n"
        "- Work\n"
        "category: Imported\n"
        "---\n"
        "\n"
        "External body text",
    )
    app = create_app(
        Settings(
            sqlite_path=tmp_path / "notes-api.sqlite",
            vault_path=vault_path,
            voyage_api_key=None,
        )
    )

    with TestClient(app) as client:
        notes_response = client.get("/notes")
        categories_response = client.get("/categories")

    assert notes_response.status_code == 200
    assert categories_response.status_code == 200
    assert categories_response.json()[0]["name"] == "Imported"
    assert notes_response.json()[0]["original_text"] == "External body text"
    assert notes_response.json()[0]["ai_title"] == "External note"
    assert notes_response.json()[0]["short_summary"] == "External summary."
    assert notes_response.json()[0]["tags"] == ["work"]
    assert notes_response.json()[0]["category"]["name"] == "Imported"


def test_create_app_reconciles_chroma_after_markdown_vault_sync(
    tmp_path: Path,
    monkeypatch,
) -> None:
    reindex_calls: list[Settings] = []

    vault_path = tmp_path / "vault"
    vault_path.mkdir()
    (vault_path / "external-note.md").write_text(
        "---\n"
        "title: External note\n"
        "summary: External summary.\n"
        "tags:\n"
        "- Work\n"
        "category: Imported\n"
        "---\n"
        "\n"
        "External body text",
    )

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def get_chunk_metadata(self) -> dict[str, dict[str, Any]]:
            return {}

        def recreate_collection(self) -> None:
            return None

    def reindex_chroma(settings: Settings) -> object:
        reindex_calls.append(settings)
        return object()

    monkeypatch.setattr(
        "mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore, raising=False
    )
    monkeypatch.setattr("mapping_memory.reindex.reindex_chroma", reindex_chroma, raising=False)
    app = create_app(
        Settings(
            sqlite_path=tmp_path / "notes-api.sqlite",
            vault_path=vault_path,
            voyage_api_key=SecretStr("test-key"),
        )
    )

    with TestClient(app) as client:
        notes_response = client.get("/notes")

    assert notes_response.status_code == 200
    assert notes_response.json()[0]["original_text"] == "External body text"
    assert len(reindex_calls) == 1


def test_create_app_does_not_backfill_markdown_for_existing_sqlite_notes(
    tmp_path: Path,
) -> None:
    vault_path = tmp_path / "vault"
    vault_path.mkdir()
    sqlite_path = tmp_path / "notes-api.sqlite"

    init_db(sqlite_path)
    note = create_note(
        sqlite_path,
        "Existing SQLite note body",
        ai_title="Existing SQLite note",
        short_summary="Existing summary.",
    )
    app = create_app(
        Settings(
            sqlite_path=sqlite_path,
            vault_path=vault_path,
            voyage_api_key=None,
        )
    )

    with TestClient(app) as client:
        notes_response = client.get("/notes")

    assert notes_response.status_code == 200
    assert notes_response.json()[0]["id"] == note.id
    assert list(vault_path.glob("*.md")) == []


def test_create_app_deletes_sqlite_note_when_tracked_markdown_file_is_missing(
    tmp_path: Path,
) -> None:
    vault_path = tmp_path / "vault"
    sqlite_path = tmp_path / "notes-api.sqlite"
    init_db(sqlite_path)
    note = create_note(
        sqlite_path,
        "Deleted from vault body CD-30954.",
        ai_title="Deleted from vault",
        vault_path=vault_path,
    )
    (vault_path / f"deleted-from-vault-{note.id}.md").unlink()
    app = create_app(
        Settings(
            sqlite_path=sqlite_path,
            vault_path=vault_path,
            voyage_api_key=None,
        )
    )

    with TestClient(app) as client:
        notes_response = client.get("/notes")

    assert notes_response.status_code == 200
    assert notes_response.json() == []
    assert get_note(sqlite_path, note.id) is None


def test_create_app_reindexes_when_sqlite_notes_have_empty_chroma(
    tmp_path: Path,
    monkeypatch,
) -> None:
    sqlite_path = tmp_path / "notes-api.sqlite"
    init_db(sqlite_path)
    create_note(sqlite_path, "Existing note that needs vectors")
    reindex_calls: list[Settings] = []

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def get_chunk_metadata(self) -> dict[str, dict[str, Any]]:
            return {}

        def recreate_collection(self) -> None:
            return None

    def reindex_chroma(settings: Settings) -> object:
        reindex_calls.append(settings)
        return object()

    monkeypatch.setattr(
        "mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore, raising=False
    )
    monkeypatch.setattr("mapping_memory.reindex.reindex_chroma", reindex_chroma, raising=False)
    reconcile_chroma_with_sqlite(
        settings=Settings(
            sqlite_path=sqlite_path,
            chroma_path=tmp_path / "chroma",
            voyage_api_key=SecretStr("test-key"),
        )
    )

    assert len(reindex_calls) == 1
    assert reindex_calls[0].sqlite_path == sqlite_path


def test_create_app_skips_reindex_when_chroma_matches_sqlite(
    tmp_path: Path,
    monkeypatch,
) -> None:
    sqlite_path = tmp_path / "notes-api.sqlite"
    init_db(sqlite_path)
    note = create_note(sqlite_path, "Existing note with current vectors")
    reindex_calls: list[Settings] = []
    chunks = create_retrieval_chunks(
        note_id=note.id,
        original_text=note.original_text,
        ai_title=note.ai_title,
        short_summary=note.short_summary,
        tags=note.tags,
        date_added=note.date_added,
        updated_at=note.updated_at,
    )
    expected_metadata = {
        build_chunk_id(note_id=chunk.note_id, chunk_index=chunk.chunk_index): build_chunk_metadata(
            chunk
        )
        for chunk in chunks
    }

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def get_chunk_metadata(self) -> dict[str, dict[str, Any]]:
            return expected_metadata

    def reindex_chroma(settings: Settings) -> object:
        reindex_calls.append(settings)
        return object()

    monkeypatch.setattr(
        "mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore, raising=False
    )
    monkeypatch.setattr("mapping_memory.reindex.reindex_chroma", reindex_chroma, raising=False)
    settings = Settings(
        sqlite_path=sqlite_path,
        chroma_path=tmp_path / "chroma",
        voyage_api_key=SecretStr("test-key"),
    )
    write_provider_fingerprint(
        chroma_fingerprint_path(settings), expected_chroma_fingerprint(settings)
    )
    reconcile_chroma_with_sqlite(settings=settings)

    assert reindex_calls == []


def test_create_app_reindexes_when_chroma_metadata_is_stale(
    tmp_path: Path,
    monkeypatch,
) -> None:
    sqlite_path = tmp_path / "notes-api.sqlite"
    init_db(sqlite_path)
    note = create_note(sqlite_path, "Existing note with stale vectors")
    reindex_calls: list[Settings] = []

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def get_chunk_metadata(self) -> dict[str, dict[str, Any]]:
            return {
                f"note:{note.id}:chunk:0": {
                    "note_id": note.id,
                    "chunk_index": 0,
                    "chunk_type": "full",
                    "ai_title": note.ai_title,
                    "tags": "[]",
                    "date_added": note.date_added,
                    "source_start": 0,
                    "source_end": len(note.original_text),
                    "category_id": 0,
                    "category_name": "Uncategorized",
                    "category_scope": "uncategorized",
                    "chunk_text_hash": "stale",
                    "note_updated_at": note.updated_at,
                }
            }

        def recreate_collection(self) -> None:
            return None

    def reindex_chroma(settings: Settings) -> object:
        reindex_calls.append(settings)
        return object()

    monkeypatch.setattr(
        "mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore, raising=False
    )
    monkeypatch.setattr("mapping_memory.reindex.reindex_chroma", reindex_chroma, raising=False)
    reconcile_chroma_with_sqlite(
        settings=Settings(
            sqlite_path=sqlite_path,
            chroma_path=tmp_path / "chroma",
            voyage_api_key=SecretStr("test-key"),
        )
    )

    assert len(reindex_calls) == 1


def test_create_app_reindexes_when_sqlite_is_empty_but_chroma_has_chunks(
    tmp_path: Path,
    monkeypatch,
) -> None:
    sqlite_path = tmp_path / "notes-api.sqlite"
    init_db(sqlite_path)
    reindex_calls: list[Settings] = []

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def get_chunk_metadata(self) -> dict[str, dict[str, Any]]:
            return {"note:999:chunk:0": {"note_id": 999}}

        def recreate_collection(self) -> None:
            return None

    def reindex_chroma(settings: Settings) -> object:
        reindex_calls.append(settings)
        return object()

    monkeypatch.setattr(
        "mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore, raising=False
    )
    monkeypatch.setattr("mapping_memory.reindex.reindex_chroma", reindex_chroma, raising=False)
    reconcile_chroma_with_sqlite(
        settings=Settings(
            sqlite_path=sqlite_path,
            chroma_path=tmp_path / "chroma",
            voyage_api_key=None,
        )
    )

    assert reindex_calls == []


def test_create_app_logs_reindex_failure_without_crashing(
    tmp_path: Path,
    monkeypatch,
    caplog,
) -> None:
    sqlite_path = tmp_path / "notes-api.sqlite"
    init_db(sqlite_path)
    create_note(sqlite_path, "Existing note with unavailable embeddings")

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def get_chunk_metadata(self) -> dict[str, dict[str, Any]]:
            return {}

        def recreate_collection(self) -> None:
            return None

    def reindex_chroma(settings: Settings) -> object:
        raise RuntimeError("provider failure with sensitive details")

    monkeypatch.setattr(
        "mapping_memory.retrieval_index.ChromaVectorStore", FakeVectorStore, raising=False
    )
    monkeypatch.setattr("mapping_memory.reindex.reindex_chroma", reindex_chroma, raising=False)
    with caplog.at_level(logging.WARNING):
        reconcile_chroma_with_sqlite(
            settings=Settings(
                sqlite_path=sqlite_path,
                chroma_path=tmp_path / "chroma",
                voyage_api_key=SecretStr("test-key"),
            )
        )

    assert "Chroma index reconciliation unavailable; continuing with existing index" in caplog.text
    assert "provider failure" not in caplog.text
