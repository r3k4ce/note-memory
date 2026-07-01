from pathlib import Path
from typing import Any, ClassVar

from fastapi.testclient import TestClient
from pydantic import SecretStr

from mapping_memory.db import init_db
from mapping_memory.notes import create_note
from mapping_memory.settings import Settings
from mapping_memory.vector_store import VectorSearchResult


class FakeVectorStore:
    results: ClassVar[list[VectorSearchResult]] = []
    error: Exception | None = None
    calls: ClassVar[list[dict[str, Any]]] = []

    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings

    def query_by_embedding(
        self,
        embedding: list[float],
        *,
        limit: int = 5,
    ) -> list[VectorSearchResult]:
        self.calls.append({"embedding": embedding, "limit": limit})
        if self.error is not None:
            raise self.error
        return self.results


def test_search_returns_exact_only_card_result(tmp_path: Path, monkeypatch) -> None:
    app = _search_app(tmp_path, monkeypatch, semantic_results=[])
    with TestClient(app) as client:
        response = client.get("/search", params={"q": "CD-30954"})

    assert response.status_code == 200
    body = response.json()
    assert body == [
        {
            "id": 1,
            "ai_title": "Competition import issue",
            "short_summary": "Ticket CD-30954 needs source reconciliation.",
            "tags": ["tickets"],
            "date_added": body[0]["date_added"],
            "score": 1.0,
        }
    ]
    assert "original_text" not in body[0]
    assert "text" not in body[0]


def test_search_returns_semantic_only_card_result(tmp_path: Path, monkeypatch) -> None:
    semantic_note = create_note(
        _init_path(tmp_path),
        "Tocantinense mapping source recreation notes.",
        ai_title="Tocantinense source rebuild",
        short_summary="Rebuild source behavior after recreation.",
        tags=["semantic"],
    )
    app = _search_app(
        tmp_path,
        monkeypatch,
        semantic_results=[
            VectorSearchResult(
                id="note:1:chunk:0",
                text="chunk text must not leak",
                metadata={"note_id": semantic_note.id},
                distance=0.12,
            )
        ],
        init_db_first=False,
    )

    with TestClient(app) as client:
        response = client.get("/search", params={"q": "source recreation issue"})

    assert response.status_code == 200
    body = response.json()
    assert body[0]["id"] == semantic_note.id
    assert body[0]["ai_title"] == "Tocantinense source rebuild"
    assert body[0]["score"] == 1.0
    assert "chunk text must not leak" not in response.text


def test_search_ranks_merged_result_above_single_source_results(
    tmp_path: Path,
    monkeypatch,
) -> None:
    sqlite_path = _init_path(tmp_path)
    merged = create_note(sqlite_path, "CD-30954 appears in both indexes.", ai_title="Merged")
    exact_only = create_note(sqlite_path, "CD-30954 exact only.", ai_title="Exact only")
    semantic_only = create_note(sqlite_path, "Related source issue.", ai_title="Semantic only")
    app = _search_app(
        tmp_path,
        monkeypatch,
        semantic_results=[
            VectorSearchResult(
                id="note:3:chunk:0",
                text="semantic only chunk",
                metadata={"note_id": semantic_only.id},
                distance=0.1,
            ),
            VectorSearchResult(
                id="note:1:chunk:0",
                text="merged chunk",
                metadata={"note_id": merged.id},
                distance=0.2,
            ),
        ],
        init_db_first=False,
    )

    with TestClient(app) as client:
        response = client.get("/search", params={"q": "CD-30954"})

    assert response.status_code == 200
    result_ids = [item["id"] for item in response.json()]
    assert result_ids[0] == merged.id
    assert set(result_ids[1:]) == {exact_only.id, semantic_only.id}


def test_search_rejects_empty_query(tmp_path: Path, monkeypatch) -> None:
    app = _search_app(tmp_path, monkeypatch, semantic_results=[])

    with TestClient(app) as client:
        blank_response = client.get("/search", params={"q": " \n\t "})
        missing_response = client.get("/search")

    assert blank_response.status_code == 400
    assert blank_response.json() == {"detail": "q must not be empty"}
    assert missing_response.status_code == 400
    assert missing_response.json() == {"detail": "q must not be empty"}


def test_search_falls_back_to_exact_results_when_semantic_search_fails(
    tmp_path: Path,
    monkeypatch,
) -> None:
    app = _search_app(
        tmp_path,
        monkeypatch,
        semantic_error=RuntimeError("provider failure with sensitive details"),
    )

    with TestClient(app) as client:
        response = client.get("/search", params={"q": "CD-30954"})

    assert response.status_code == 200
    assert [item["ai_title"] for item in response.json()] == ["Competition import issue"]
    assert "provider failure" not in response.text


def _init_path(tmp_path: Path) -> Path:
    sqlite_path = tmp_path / "notes-api.sqlite"
    init_db(sqlite_path)
    return sqlite_path


def _search_app(
    tmp_path: Path,
    monkeypatch,
    *,
    semantic_results: list[VectorSearchResult] | None = None,
    semantic_error: Exception | None = None,
    init_db_first: bool = True,
):
    from mapping_memory.main import create_app

    sqlite_path = tmp_path / "notes-api.sqlite"
    if init_db_first:
        init_db(sqlite_path)
        create_note(
            sqlite_path,
            "Investigate ticket CD-30954 before publishing.",
            ai_title="Competition import issue",
            short_summary="Ticket CD-30954 needs source reconciliation.",
            tags=["tickets"],
        )

    def embed_texts(texts: list[str], *, settings: Settings) -> list[list[float]]:
        assert texts
        return [[0.1, 0.2, 0.3]]

    FakeVectorStore.results = semantic_results or []
    FakeVectorStore.error = semantic_error
    FakeVectorStore.calls = []
    monkeypatch.setattr("mapping_memory.search.embed_texts", embed_texts, raising=False)
    monkeypatch.setattr("mapping_memory.search.ChromaVectorStore", FakeVectorStore, raising=False)
    return create_app(Settings(sqlite_path=sqlite_path, openai_api_key=SecretStr("test-key")))
