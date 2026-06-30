import logging
from pathlib import Path

from fastapi.testclient import TestClient
from pydantic import SecretStr

from mapping_memory.ai import OrganizerMetadata
from mapping_memory.main import create_app
from mapping_memory.settings import Settings


def test_post_notes_creates_note_with_ai_metadata_when_organizer_succeeds(
    tmp_path: Path,
    monkeypatch,
) -> None:
    calls: list[str] = []

    def organize_mapping_text(original_text: str, *, settings: Settings) -> OrganizerMetadata:
        calls.append(original_text)
        assert settings.openai_organizer_model == "test-model"
        return OrganizerMetadata(
            title="AI route labels",
            summary="AI summary for route label notes.",
            tags=["routing", "labels", "retrieval"],
        )

    monkeypatch.setattr(
        "mapping_memory.main.organize_mapping_text",
        organize_mapping_text,
        raising=False,
    )
    app = create_app(
        Settings(
            sqlite_path=tmp_path / "notes-api.sqlite",
            openai_api_key=SecretStr("test-key"),
            openai_organizer_model="test-model",
        )
    )

    with TestClient(app) as client:
        response = client.post("/notes", json={"original_text": "Route label notes"})

    assert response.status_code == 201
    assert calls == ["Route label notes"]
    assert response.json() == {
        "id": 1,
        "original_text": "Route label notes",
        "ai_title": "AI route labels",
        "short_summary": "AI summary for route label notes.",
        "tags": ["routing", "labels", "retrieval"],
        "date_added": response.json()["date_added"],
        "updated_at": response.json()["date_added"],
    }


def test_post_notes_uses_fallback_metadata_when_organizer_fails(
    tmp_path: Path,
    monkeypatch,
    caplog,
) -> None:
    original_text = "Fallback API title\nBody text that must not be logged"

    def organize_mapping_text(original_text: str, *, settings: Settings) -> OrganizerMetadata:
        raise RuntimeError("provider failure with sensitive details")

    monkeypatch.setattr(
        "mapping_memory.main.organize_mapping_text",
        organize_mapping_text,
        raising=False,
    )
    app = create_app(
        Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=SecretStr("test-key"))
    )

    with caplog.at_level(logging.WARNING), TestClient(app) as client:
        response = client.post("/notes", json={"original_text": original_text})

    assert response.status_code == 201
    assert response.json() == {
        "id": 1,
        "original_text": original_text,
        "ai_title": "Fallback API title",
        "short_summary": original_text[:250],
        "tags": [],
        "date_added": response.json()["date_added"],
        "updated_at": response.json()["date_added"],
    }
    assert "AI organizer unavailable; saved note with fallback metadata" in caplog.text
    assert original_text not in caplog.text
    assert "provider failure" not in caplog.text


def test_post_notes_uses_fallback_metadata_when_api_key_missing(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        response = client.post("/notes", json={"original_text": "Missing key title\nBody"})

    assert response.status_code == 201
    assert response.json()["ai_title"] == "Missing key title"
    assert response.json()["short_summary"] == "Missing key title\nBody"
    assert response.json()["tags"] == []


def test_post_notes_preserves_original_text_exactly_with_ai_metadata(
    tmp_path: Path,
    monkeypatch,
) -> None:
    original_text = "  Leading spaces\n\n\tTabbed line  \nTrailing newline\n"

    def organize_mapping_text(original_text: str, *, settings: Settings) -> OrganizerMetadata:
        return OrganizerMetadata(
            title="AI exact text title",
            summary="AI exact text summary.",
            tags=["exact-text"],
        )

    monkeypatch.setattr(
        "mapping_memory.main.organize_mapping_text",
        organize_mapping_text,
        raising=False,
    )
    app = create_app(
        Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=SecretStr("test-key"))
    )

    with TestClient(app) as client:
        response = client.post("/notes", json={"original_text": original_text})
        fetched_response = client.get(f"/notes/{response.json()['id']}")

    assert response.status_code == 201
    assert response.json()["original_text"] == original_text
    assert fetched_response.json()["original_text"] == original_text


def test_post_notes_creates_note_with_fallback_metadata(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        response = client.post("/notes", json={"original_text": "\n  API note title  \nBody text"})

    assert response.status_code == 201
    assert response.json() == {
        "id": 1,
        "original_text": "\n  API note title  \nBody text",
        "ai_title": "API note title",
        "short_summary": "\n  API note title  \nBody text",
        "tags": [],
        "date_added": response.json()["date_added"],
        "updated_at": response.json()["date_added"],
    }


def test_get_notes_lists_saved_notes(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        older_response = client.post("/notes", json={"original_text": "Older API note"})
        newer_response = client.post("/notes", json={"original_text": "Newer API note"})
        response = client.get("/notes")

    assert response.status_code == 200
    assert response.json() == [newer_response.json(), older_response.json()]


def test_get_note_returns_saved_note(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        created_response = client.post("/notes", json={"original_text": "One API note"})
        response = client.get(f"/notes/{created_response.json()['id']}")

    assert response.status_code == 200
    assert response.json() == created_response.json()


def test_get_note_returns_404_for_missing_id(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        response = client.get("/notes/999999")

    assert response.status_code == 404
    assert response.json() == {"detail": "Note not found"}


def test_post_notes_rejects_empty_original_text(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        response = client.post("/notes", json={"original_text": " \n\t "})

    assert response.status_code == 422
    assert "original_text must not be empty" in response.text


def test_local_vite_origin_receives_cors_headers(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        response = client.options(
            "/notes",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
