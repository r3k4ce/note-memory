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
        "category": None,
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
        "category": None,
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
        "category": None,
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


def test_patch_note_updates_original_text_and_get_returns_updated_body(
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
            json={"original_text": "Updated body\nwith exact text"},
        )
        fetched_response = client.get(f"/notes/{created_response.json()['id']}")

    assert response.status_code == 200
    assert response.json()["original_text"] == "Updated body\nwith exact text"
    assert response.json()["ai_title"] == created_response.json()["ai_title"]
    assert response.json()["short_summary"] == created_response.json()["short_summary"]
    assert response.json()["tags"] == created_response.json()["tags"]
    assert response.json()["date_added"] == created_response.json()["date_added"]
    assert response.json()["updated_at"] >= created_response.json()["updated_at"]
    assert fetched_response.status_code == 200
    assert fetched_response.json() == response.json()


def test_patch_note_calls_reindex_with_updated_body(
    tmp_path: Path,
    monkeypatch,
) -> None:
    reindexed_notes: list[Any] = []

    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )

    def reindex_note_for_retrieval(note: Any, *, settings: Settings) -> None:
        reindexed_notes.append(note)

    monkeypatch.setattr(
        "mapping_memory.main._reindex_note_for_retrieval",
        reindex_note_for_retrieval,
        raising=False,
    )
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        created_response = client.post("/notes", json={"original_text": "Original body"})
        response = client.patch(
            f"/notes/{created_response.json()['id']}",
            json={"original_text": "Updated body for retrieval chunks"},
        )

    assert response.status_code == 200
    assert len(reindexed_notes) == 1
    assert reindexed_notes[0].id == created_response.json()["id"]
    assert reindexed_notes[0].original_text == "Updated body for retrieval chunks"


def test_patch_note_refreshes_exact_search_for_updated_body(
    tmp_path: Path,
    monkeypatch,
) -> None:
    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def update_chunk_metadata(self, chunks: list[Any]) -> None:
            pass

        def query_by_embedding(
            self,
            embedding: list[float],
            *,
            limit: int = 5,
            where: dict[str, Any] | None = None,
        ) -> list[Any]:
            return []

    def embed_texts(texts: list[str], *, settings: Settings) -> list[list[float]]:
        return [[0.1, 0.2, 0.3] for _ in texts]

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
    monkeypatch.setattr("mapping_memory.search.embed_texts", embed_texts, raising=False)
    monkeypatch.setattr("mapping_memory.search.ChromaVectorStore", FakeVectorStore, raising=False)
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    original_text = f"Stable title\n{'padding ' * 40}oldbodyonly."

    with TestClient(app) as client:
        created_response = client.post(
            "/notes",
            json={"original_text": original_text},
        )
        note_id = created_response.json()["id"]
        response = client.patch(
            f"/notes/{note_id}",
            json={"original_text": "Updated body with newbodyonly."},
        )
        new_search_response = client.get("/search", params={"q": "newbodyonly"})
        old_search_response = client.get("/search", params={"q": "oldbodyonly"})

    assert response.status_code == 200
    assert new_search_response.status_code == 200
    assert [result["id"] for result in new_search_response.json()] == [note_id]
    assert old_search_response.status_code == 200
    assert old_search_response.json() == []


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
            client.patch(note_url, json={"original_text": " \n\t "}),
            client.patch(note_url, json={"ai_title": "  "}),
            client.patch(note_url, json={"short_summary": "\t"}),
            client.patch(note_url, json={"tags": ["valid", 1]}),
            client.patch(note_url, json={"tags": ["valid", "  "]}),
            client.patch(note_url, json={"tags": [str(index) for index in range(11)]}),
        ]

    assert [response.status_code for response in responses] == [422, 422, 422, 422, 422, 422, 422]


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
                "original_text": "Updated body for fresh Chroma chunks",
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
    assert "Chunk: Updated body for fresh Chroma chunks" in chunks[0].text
    assert "Original body" not in chunks[0].text
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


def test_delete_note_removes_note_and_chroma_chunks(
    tmp_path: Path,
    monkeypatch,
) -> None:
    delete_calls: list[int] = []

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def delete_chunks_for_note(self, note_id: int) -> None:
            delete_calls.append(note_id)

    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    monkeypatch.setattr("mapping_memory.main.ChromaVectorStore", FakeVectorStore, raising=False)
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        first_response = client.post("/notes", json={"original_text": "Delete API note"})
        second_response = client.post("/notes", json={"original_text": "Keep API note"})
        note_id = first_response.json()["id"]
        response = client.delete(f"/notes/{note_id}")
        fetched_response = client.get(f"/notes/{note_id}")
        list_response = client.get("/notes")

    assert response.status_code == 200
    assert response.json() == {"id": note_id, "deleted": True, "vector_cleanup": "deleted"}
    assert fetched_response.status_code == 404
    assert [note["id"] for note in list_response.json()] == [second_response.json()["id"]]
    assert delete_calls == [note_id]


def test_delete_note_returns_404_for_missing_id(
    tmp_path: Path,
    monkeypatch,
) -> None:
    delete_calls: list[int] = []

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def delete_chunks_for_note(self, note_id: int) -> None:
            delete_calls.append(note_id)

    monkeypatch.setattr("mapping_memory.main.ChromaVectorStore", FakeVectorStore, raising=False)
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        response = client.delete("/notes/999999")

    assert response.status_code == 404
    assert response.json() == {"detail": "Note not found"}
    assert delete_calls == []


def test_delete_note_keeps_sqlite_delete_when_chroma_cleanup_fails(
    tmp_path: Path,
    monkeypatch,
    caplog,
) -> None:
    original_text = "Delete body that must not be logged"

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def delete_chunks_for_note(self, note_id: int) -> None:
            raise RuntimeError("provider failure with sensitive details")

    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    monkeypatch.setattr("mapping_memory.main.ChromaVectorStore", FakeVectorStore, raising=False)
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with caplog.at_level(logging.WARNING), TestClient(app) as client:
        created_response = client.post("/notes", json={"original_text": original_text})
        note_id = created_response.json()["id"]
        response = client.delete(f"/notes/{note_id}")
        fetched_response = client.get(f"/notes/{note_id}")

    assert response.status_code == 200
    assert response.json() == {"id": note_id, "deleted": True, "vector_cleanup": "failed"}
    assert fetched_response.status_code == 404
    assert "Retrieval cleanup unavailable; deleted note without vector cleanup" in caplog.text
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


def test_local_vite_origin_can_preflight_delete(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        response = client.options(
            "/notes/1",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "DELETE",
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


def test_categories_api_creates_lists_and_rejects_duplicates(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        empty_response = client.get("/categories")
        created_response = client.post("/categories", json={"name": " Work "})
        list_response = client.get("/categories")
        duplicate_response = client.post("/categories", json={"name": "work"})

    assert empty_response.status_code == 200
    assert empty_response.json() == []
    assert created_response.status_code == 201
    assert created_response.json() == {
        "id": 1,
        "name": "Work",
        "slug": "work",
        "created_at": created_response.json()["created_at"],
        "updated_at": created_response.json()["created_at"],
    }
    assert list_response.status_code == 200
    assert list_response.json() == [created_response.json()]
    assert duplicate_response.status_code == 409
    assert duplicate_response.json() == {"detail": "Category already exists"}


def test_categories_api_renames_category_and_rejects_duplicates(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        work_response = client.post("/categories", json={"name": "Work"})
        client.post("/categories", json={"name": "Personal"})
        renamed_response = client.patch(
            f"/categories/{work_response.json()['id']}",
            json={"name": " Projects "},
        )
        list_response = client.get("/categories")
        duplicate_response = client.patch(
            f"/categories/{work_response.json()['id']}",
            json={"name": "personal"},
        )
        missing_response = client.patch("/categories/999999", json={"name": "Missing"})

    assert renamed_response.status_code == 200
    assert renamed_response.json()["id"] == work_response.json()["id"]
    assert renamed_response.json()["name"] == "Projects"
    assert renamed_response.json()["slug"] == "projects"
    assert [category["name"] for category in list_response.json()] == ["Personal", "Projects"]
    assert duplicate_response.status_code == 409
    assert duplicate_response.json() == {"detail": "Category already exists"}
    assert missing_response.status_code == 404
    assert missing_response.json() == {"detail": "Category not found"}


def test_categories_api_deletes_category_notes_and_chroma_chunks(
    tmp_path: Path,
    monkeypatch,
) -> None:
    deleted_chunks: list[int] = []

    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def delete_chunks_for_note(self, note_id: int) -> None:
            deleted_chunks.append(note_id)

    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    monkeypatch.setattr("mapping_memory.main.ChromaVectorStore", FakeVectorStore, raising=False)
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        category_response = client.post("/categories", json={"name": "Work"})
        category_id = category_response.json()["id"]
        deleted_note_response = client.post(
            "/notes",
            json={"original_text": "Work note", "category_id": category_id},
        )
        kept_note_response = client.post("/notes", json={"original_text": "Loose note"})
        delete_response = client.delete(f"/categories/{category_id}")
        categories_response = client.get("/categories")
        deleted_note_fetch = client.get(f"/notes/{deleted_note_response.json()['id']}")
        kept_note_fetch = client.get(f"/notes/{kept_note_response.json()['id']}")

    assert delete_response.status_code == 200
    assert delete_response.json() == {
        "id": category_id,
        "deleted": True,
        "deleted_note_ids": [deleted_note_response.json()["id"]],
        "vector_cleanup": "deleted",
    }
    assert deleted_chunks == [deleted_note_response.json()["id"]]
    assert categories_response.json() == []
    assert deleted_note_fetch.status_code == 404
    assert kept_note_fetch.status_code == 200


def test_categories_api_delete_reports_failed_chroma_cleanup(
    tmp_path: Path,
    monkeypatch,
    caplog,
) -> None:
    class FakeVectorStore:
        def __init__(self, *, settings: Settings) -> None:
            self.settings = settings

        def delete_chunks_for_note(self, note_id: int) -> None:
            raise RuntimeError("provider failure with sensitive details")

    monkeypatch.setattr(
        "mapping_memory.main._index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    monkeypatch.setattr("mapping_memory.main.ChromaVectorStore", FakeVectorStore, raising=False)
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=None))

    with caplog.at_level(logging.WARNING), TestClient(app) as client:
        category_response = client.post("/categories", json={"name": "Work"})
        note_response = client.post(
            "/notes",
            json={"original_text": "Work note", "category_id": category_response.json()["id"]},
        )
        delete_response = client.delete(f"/categories/{category_response.json()['id']}")
        deleted_note_fetch = client.get(f"/notes/{note_response.json()['id']}")

    assert delete_response.status_code == 200
    assert delete_response.json()["vector_cleanup"] == "failed"
    assert deleted_note_fetch.status_code == 404
    assert (
        "Retrieval cleanup unavailable; deleted category without full vector cleanup" in caplog.text
    )
    assert "provider failure" not in caplog.text


def test_notes_api_creates_updates_and_filters_by_category(
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
        category_response = client.post("/categories", json={"name": "Projects"})
        category = category_response.json()
        uncategorized_response = client.post("/notes", json={"original_text": "Loose note"})
        categorized_response = client.post(
            "/notes",
            json={"original_text": "Project note", "category_id": category["id"]},
        )
        filtered_response = client.get(f"/notes?category_id={category['id']}")
        cleared_response = client.patch(
            f"/notes/{categorized_response.json()['id']}",
            json={"category_id": None},
        )
        invalid_response = client.post(
            "/notes",
            json={"original_text": "Invalid note", "category_id": 999999},
        )

    assert category_response.status_code == 201
    assert uncategorized_response.status_code == 201
    assert uncategorized_response.json()["category"] is None
    assert categorized_response.status_code == 201
    assert categorized_response.json()["category"] == category
    assert filtered_response.status_code == 200
    assert [note["id"] for note in filtered_response.json()] == [categorized_response.json()["id"]]
    assert cleared_response.status_code == 200
    assert cleared_response.json()["category"] is None
    assert invalid_response.status_code == 422
    assert invalid_response.json() == {"detail": "Category not found"}


def test_post_notes_rejects_invalid_category_before_organizer(
    tmp_path: Path,
    monkeypatch,
) -> None:
    calls: list[str] = []

    def organize_mapping_text(original_text: str, *, settings: Settings) -> OrganizerMetadata:
        calls.append(original_text)
        return OrganizerMetadata(title="Title", summary="Summary.", tags=[])

    monkeypatch.setattr(
        "mapping_memory.main.organize_mapping_text",
        organize_mapping_text,
        raising=False,
    )
    app = create_app(
        Settings(sqlite_path=tmp_path / "notes-api.sqlite", openai_api_key=SecretStr("test-key"))
    )

    with TestClient(app) as client:
        response = client.post(
            "/notes",
            json={"original_text": "Invalid category", "category_id": 999999},
        )

    assert response.status_code == 422
    assert response.json() == {"detail": "Category not found"}
    assert calls == []
