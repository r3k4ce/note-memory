import logging
from pathlib import Path

from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from mapping_memory.categories_api import create_categories_router
from mapping_memory.main import create_app
from mapping_memory.settings import Settings


def test_categories_router_registers_category_routes(tmp_path: Path) -> None:
    router = create_categories_router(Settings(sqlite_path=tmp_path / "categories-router.sqlite"))

    assert {route.path for route in router.routes if isinstance(route, APIRoute)} == {
        "/categories",
        "/categories/{category_id}",
    }


def test_categories_api_creates_lists_and_rejects_duplicates(tmp_path: Path) -> None:
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", voyage_api_key=None))

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
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", voyage_api_key=None))

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


def test_categories_api_rename_reindexes_category_notes(
    tmp_path: Path,
    monkeypatch,
) -> None:
    reindexed_note_ids: list[int] = []

    monkeypatch.setattr(
        "mapping_memory.retrieval_index.index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    monkeypatch.setattr(
        "mapping_memory.retrieval_index.reindex_note_for_retrieval",
        lambda note, **kwargs: reindexed_note_ids.append(note.id),
        raising=False,
    )
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", voyage_api_key=None))

    with TestClient(app) as client:
        category_response = client.post("/categories", json={"name": "Work"})
        category_id = category_response.json()["id"]
        first_note = client.post(
            "/notes",
            json={"original_text": "First work note", "category_id": category_id},
        ).json()
        second_note = client.post(
            "/notes",
            json={"original_text": "Second work note", "category_id": category_id},
        ).json()
        client.post("/notes", json={"original_text": "Loose note"})
        response = client.patch(f"/categories/{category_id}", json={"name": "Projects"})

    assert response.status_code == 200
    assert reindexed_note_ids == [second_note["id"], first_note["id"]]


def test_categories_api_deletes_category_and_uncategorizes_notes(
    tmp_path: Path,
    monkeypatch,
) -> None:
    reindexed_note_ids: list[int] = []

    monkeypatch.setattr(
        "mapping_memory.retrieval_index.index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    monkeypatch.setattr(
        "mapping_memory.retrieval_index.reindex_note_for_retrieval",
        lambda note, **kwargs: reindexed_note_ids.append(note.id),
        raising=False,
    )
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", voyage_api_key=None))

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
        uncategorized_note_fetch = client.get(f"/notes/{deleted_note_response.json()['id']}")
        kept_note_fetch = client.get(f"/notes/{kept_note_response.json()['id']}")

    assert delete_response.status_code == 200
    assert delete_response.json() == {
        "id": category_id,
        "deleted": True,
        "deleted_note_ids": [],
        "uncategorized_note_ids": [deleted_note_response.json()["id"]],
        "vector_cleanup": "deleted",
    }
    assert reindexed_note_ids == [deleted_note_response.json()["id"]]
    assert categories_response.json() == []
    assert uncategorized_note_fetch.status_code == 200
    assert uncategorized_note_fetch.json()["category"] is None
    assert kept_note_fetch.status_code == 200


def test_categories_api_delete_reports_failed_reindex(
    tmp_path: Path,
    monkeypatch,
    caplog,
) -> None:
    monkeypatch.setattr(
        "mapping_memory.retrieval_index.index_note_for_retrieval",
        lambda *args, **kwargs: None,
        raising=False,
    )
    monkeypatch.setattr(
        "mapping_memory.retrieval_index.reindex_note_for_retrieval",
        lambda *args, **kwargs: (_ for _ in ()).throw(
            RuntimeError("provider failure with sensitive details")
        ),
        raising=False,
    )
    app = create_app(Settings(sqlite_path=tmp_path / "notes-api.sqlite", voyage_api_key=None))

    with caplog.at_level(logging.WARNING), TestClient(app) as client:
        category_response = client.post("/categories", json={"name": "Work"})
        note_response = client.post(
            "/notes",
            json={"original_text": "Work note", "category_id": category_response.json()["id"]},
        )
        delete_response = client.delete(f"/categories/{category_response.json()['id']}")
        uncategorized_note_fetch = client.get(f"/notes/{note_response.json()['id']}")

    assert delete_response.status_code == 200
    assert delete_response.json()["vector_cleanup"] == "failed"
    assert uncategorized_note_fetch.status_code == 200
    assert uncategorized_note_fetch.json()["category"] is None
    assert (
        "Retrieval cleanup unavailable; uncategorized category notes without full vector cleanup"
        in caplog.text
    )
    assert "provider failure" not in caplog.text
