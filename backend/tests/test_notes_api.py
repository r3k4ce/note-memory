import logging
from pathlib import Path
from typing import Any

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
    embedding_calls: list[dict[str, Any]] = []
    store_instances: list[Any] = []

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings
            self.add_calls: list[dict[str, Any]] = []
            store_instances.append(self)

        def add_chunks(self, chunks: list[Any], *, embeddings: list[list[float]]) -> None:
            self.add_calls.append({"chunks": list(chunks), "embeddings": embeddings})

    def organize_mapping_text(original_text: str, *, settings: Settings) -> OrganizerMetadata:
        calls.append(original_text)
        assert settings.openai_organizer_model == "test-model"
        return OrganizerMetadata(
            title="AI route labels",
            summary="AI summary for route label notes.",
            tags=["routing", "labels", "retrieval"],
        )

    def embed_texts(texts: list[str], *, settings: Settings) -> list[list[float]]:
        embedding_calls.append({"texts": texts, "settings": settings})
        return [[0.1, 0.2, 0.3] for _ in texts]

    monkeypatch.setattr(
        "mapping_memory.main.organize_mapping_text",
        organize_mapping_text,
        raising=False,
    )
    monkeypatch.setattr("mapping_memory.main.embed_texts", embed_texts, raising=False)
    monkeypatch.setattr("mapping_memory.main.ChromaVectorStore", FakeVectorStore, raising=False)
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
    assert len(store_instances) == 1
    assert store_instances[0].settings.openai_embedding_model == "text-embedding-3-small"
    assert len(store_instances[0].add_calls) == 1
    add_call = store_instances[0].add_calls[0]
    chunks = add_call["chunks"]
    assert len(chunks) == 1
    assert chunks[0].note_id == response.json()["id"]
    assert chunks[0].chunk_index == 0
    assert chunks[0].chunk_type == "full"
    assert chunks[0].title == "AI route labels"
    assert chunks[0].tags == ("routing", "labels", "retrieval")
    assert chunks[0].date_added == response.json()["date_added"]
    assert "Chunk: Route label notes" in chunks[0].text
    assert embedding_calls == [{"texts": [chunks[0].text], "settings": store_instances[0].settings}]
    assert add_call["embeddings"] == [[0.1, 0.2, 0.3]]


def test_post_notes_keeps_saved_note_when_indexing_fails(
    tmp_path: Path,
    monkeypatch,
    caplog,
) -> None:
    original_text = "Indexed failure title\nBody text that must not be logged"

    def organize_mapping_text(original_text: str, *, settings: Settings) -> OrganizerMetadata:
        return OrganizerMetadata(
            title="Indexing failure title",
            summary="Indexing failure summary.",
            tags=["indexing"],
        )

    def embed_texts(texts: list[str], *, settings: Settings) -> list[list[float]]:
        raise RuntimeError("embedding provider failure with sensitive details")

    monkeypatch.setattr(
        "mapping_memory.main.organize_mapping_text",
        organize_mapping_text,
        raising=False,
    )
    monkeypatch.setattr("mapping_memory.main.embed_texts", embed_texts, raising=False)
    app = create_app(
        Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=SecretStr("test-key"))
    )

    with caplog.at_level(logging.WARNING), TestClient(app) as client:
        response = client.post("/notes", json={"original_text": original_text})
        fetched_response = client.get(f"/notes/{response.json()['id']}")

    assert response.status_code == 201
    assert response.json()["original_text"] == original_text
    assert response.json()["ai_title"] == "Indexing failure title"
    assert response.json()["short_summary"] == "Indexing failure summary."
    assert response.json()["tags"] == ["indexing"]
    assert fetched_response.status_code == 200
    assert fetched_response.json() == response.json()
    assert "Retrieval indexing unavailable; saved note without vector index" in caplog.text
    assert original_text not in caplog.text
    assert "provider failure" not in caplog.text


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
    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
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
    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
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


def test_patch_note_updates_metadata_and_get_returns_updated_note(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    monkeypatch.setattr(
        "mapping_memory.main._reindex_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        created_response = client.post("/notes", json={"original_text": "Original body"})
        response = client.patch(
            f"/notes/{created_response.json()['id']}",
            json={
                "ai_title": "Corrected title",
                "short_summary": "Corrected summary.",
                "tags": [" Routing ", "routing", "Memory"],
            },
        )
        fetched_response = client.get(f"/notes/{created_response.json()['id']}")

    assert response.status_code == 200
    assert response.json()["original_text"] == "Original body"
    assert response.json()["ai_title"] == "Corrected title"
    assert response.json()["short_summary"] == "Corrected summary."
    assert response.json()["tags"] == ["routing", "memory"]
    assert response.json()["date_added"] == created_response.json()["date_added"]
    assert response.json()["updated_at"] >= created_response.json()["updated_at"]
    assert fetched_response.status_code == 200
    assert fetched_response.json() == response.json()


def test_patch_note_rejects_original_text_update(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        created_response = client.post("/notes", json={"original_text": "Original body"})
        response = client.patch(
            f"/notes/{created_response.json()['id']}",
            json={"original_text": "Changed body"},
        )
        fetched_response = client.get(f"/notes/{created_response.json()['id']}")

    assert response.status_code == 422
    assert fetched_response.json()["original_text"] == "Original body"


def test_patch_note_rejects_empty_or_invalid_metadata(
    tmp_path: Path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        created_response = client.post("/notes", json={"original_text": "Original body"})
        note_url = f"/notes/{created_response.json()['id']}"

        responses = [
            client.patch(note_url, json={}),
            client.patch(note_url, json={"ai_title": "  "}),
            client.patch(note_url, json={"short_summary": "\t"}),
            client.patch(note_url, json={"tags": ["valid", 1]}),
            client.patch(note_url, json={"tags": ["valid", "  "]}),
            client.patch(note_url, json={"tags": [str(index) for index in range(11)]}),
        ]

    assert [response.status_code for response in responses] == [422, 422, 422, 422, 422, 422]


def test_patch_note_reindexes_chroma_chunks(
    tmp_path: Path,
    monkeypatch,
) -> None:
    embedding_calls: list[dict[str, Any]] = []
    store_instances: list[Any] = []

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings
            self.delete_calls: list[int] = []
            self.add_calls: list[dict[str, Any]] = []
            store_instances.append(self)

        def delete_chunks_for_note(self, note_id: int) -> None:
            self.delete_calls.append(note_id)

        def add_chunks(self, chunks: list[Any], *, embeddings: list[list[float]]) -> None:
            self.add_calls.append({"chunks": list(chunks), "embeddings": embeddings})

    def embed_texts(texts: list[str], *, settings: Settings) -> list[list[float]]:
        embedding_calls.append({"texts": texts, "settings": settings})
        return [[0.4, 0.5, 0.6] for _ in texts]

    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    monkeypatch.setattr("mapping_memory.main.embed_texts", embed_texts, raising=False)
    monkeypatch.setattr("mapping_memory.main.ChromaVectorStore", FakeVectorStore, raising=False)
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        created_response = client.post("/notes", json={"original_text": "Original body"})
        response = client.patch(
            f"/notes/{created_response.json()['id']}",
            json={
                "ai_title": "Reindexed title",
                "short_summary": "Reindexed summary.",
                "tags": ["reindexed"],
            },
        )

    assert response.status_code == 200
    assert len(store_instances) == 1
    assert store_instances[0].delete_calls == [response.json()["id"]]
    assert len(store_instances[0].add_calls) == 1
    add_call = store_instances[0].add_calls[0]
    chunks = add_call["chunks"]
    assert len(chunks) == 1
    assert chunks[0].note_id == response.json()["id"]
    assert chunks[0].title == "Reindexed title"
    assert chunks[0].tags == ("reindexed",)
    assert "Summary: Reindexed summary." in chunks[0].text
    assert embedding_calls == [{"texts": [chunks[0].text], "settings": store_instances[0].settings}]
    assert add_call["embeddings"] == [[0.4, 0.5, 0.6]]


def test_patch_note_keeps_sqlite_update_when_reindex_fails(
    tmp_path: Path,
    monkeypatch,
    caplog,
) -> None:
    original_text = "Original body that must not be logged"

    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )

    def reindex_note_for_retrieval(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("provider failure with sensitive details")

    monkeypatch.setattr(
        "mapping_memory.main._reindex_note_for_retrieval",
        reindex_note_for_retrieval,
        raising=False,
    )
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with caplog.at_level(logging.WARNING), TestClient(app) as client:
        created_response = client.post("/notes", json={"original_text": original_text})
        response = client.patch(
            f"/notes/{created_response.json()['id']}",
            json={"ai_title": "Saved despite reindex failure"},
        )
        fetched_response = client.get(f"/notes/{created_response.json()['id']}")

    assert response.status_code == 200
    assert response.json()["ai_title"] == "Saved despite reindex failure"
    assert fetched_response.json() == response.json()
    assert (
        "Retrieval reindexing unavailable; saved note metadata without vector index" in caplog.text
    )
    assert original_text not in caplog.text
    assert "provider failure" not in caplog.text


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


def test_local_vite_origin_can_preflight_patch(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        response = client.options(
            "/notes/1",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "PATCH",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


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
