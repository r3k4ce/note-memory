from pathlib import Path
from typing import Any, ClassVar

from fastapi.testclient import TestClient
from pydantic import SecretStr

from mapping_memory.db import init_db
from mapping_memory.notes import create_category, create_note
from mapping_memory.settings import Settings
from mapping_memory.vector_store import VectorSearchResult


class FakeVectorStore:
    results: ClassVar[list[VectorSearchResult]] = []
    error: Exception | None = None
    calls: ClassVar[list[dict[str, Any]]] = []

    def __init__(self, *, settings: Settings) -> None:
        self.settings = settings

    def update_chunk_metadata(self, chunks: list[Any]) -> None:
        self.calls.append(
            {"updated_chunks": [(chunk.note_id, chunk.chunk_index) for chunk in chunks]}
        )

    def query_by_embedding(
        self,
        embedding: list[float],
        *,
        limit: int = 5,
        where: dict[str, Any] | None = None,
    ) -> list[VectorSearchResult]:
        self.calls.append({"embedding": embedding, "limit": limit, "where": where})
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
            "category": None,
            "matched_snippet": "Investigate ticket CD-30954 before publishing.",
            "match_type": "exact",
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
    assert body[0]["matched_snippet"] is None
    assert body[0]["match_type"] == "semantic"
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
    body = response.json()
    result_ids = [item["id"] for item in body]
    assert result_ids[0] == merged.id
    assert set(result_ids[1:]) == {exact_only.id, semantic_only.id}
    match_types = {item["id"]: item["match_type"] for item in body}
    assert match_types == {
        merged.id: "hybrid",
        exact_only.id: "exact",
        semantic_only.id: "semantic",
    }
    snippets = {item["id"]: item["matched_snippet"] for item in body}
    assert snippets[merged.id] == "CD-30954 appears in both indexes."
    assert snippets[exact_only.id] == "CD-30954 exact only."
    assert snippets[semantic_only.id] is None


def test_search_returns_exact_metadata_snippet(tmp_path: Path, monkeypatch) -> None:
    sqlite_path = _init_path(tmp_path)
    note = create_note(
        sqlite_path,
        "Body text only mentions general mapping work.",
        ai_title="Competition import issue",
        short_summary="Ticket CD-30954 needs source reconciliation.",
        tags=["tickets"],
    )
    app = _search_app(tmp_path, monkeypatch, semantic_results=[], init_db_first=False)

    with TestClient(app) as client:
        response = client.get("/search", params={"q": "CD-30954"})

    assert response.status_code == 200
    body = response.json()
    assert [item["id"] for item in body] == [note.id]
    assert body[0]["matched_snippet"] == "Ticket CD-30954 needs source reconciliation."


def test_search_returns_short_exact_body_snippet(tmp_path: Path, monkeypatch) -> None:
    sqlite_path = _init_path(tmp_path)
    create_note(
        sqlite_path,
        (f"{'before ' * 80}CD-30954{' after' * 80}"),
    )
    app = _search_app(tmp_path, monkeypatch, semantic_results=[], init_db_first=False)

    with TestClient(app) as client:
        response = client.get("/search", params={"q": "CD-30954"})

    assert response.status_code == 200
    snippet = response.json()[0]["matched_snippet"]
    assert snippet is not None
    assert len(snippet) <= 240
    assert snippet.startswith("...")
    assert snippet.endswith("...")


def test_search_filters_exact_results_to_uncategorized_scope(
    tmp_path: Path,
    monkeypatch,
) -> None:
    sqlite_path = _init_path(tmp_path)
    category = create_category(sqlite_path, "Projects")
    uncategorized = create_note(sqlite_path, "Shared keyword CD-30954 uncategorized")
    create_note(sqlite_path, "Shared keyword CD-30954 categorized", category_id=category.id)
    app = _search_app(tmp_path, monkeypatch, semantic_results=[], init_db_first=False)

    with TestClient(app) as client:
        response = client.get("/search", params={"q": "CD-30954", "uncategorized": "true"})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [uncategorized.id]


def test_search_filters_exact_results_to_specific_category(
    tmp_path: Path,
    monkeypatch,
) -> None:
    sqlite_path = _init_path(tmp_path)
    category = create_category(sqlite_path, "Projects")
    included = create_note(
        sqlite_path, "Shared keyword CD-30954 categorized", category_id=category.id
    )
    create_note(sqlite_path, "Shared keyword CD-30954 uncategorized")
    app = _search_app(tmp_path, monkeypatch, semantic_results=[], init_db_first=False)

    with TestClient(app) as client:
        response = client.get("/search", params={"q": "CD-30954", "category_id": category.id})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [included.id]


def test_search_passes_category_scope_to_semantic_search(
    tmp_path: Path,
    monkeypatch,
) -> None:
    sqlite_path = _init_path(tmp_path)
    category = create_category(sqlite_path, "Projects")
    note = create_note(sqlite_path, "Semantic project source", category_id=category.id)
    app = _search_app(
        tmp_path,
        monkeypatch,
        semantic_results=[
            VectorSearchResult(
                id="note:1:chunk:0",
                text="semantic chunk",
                metadata={"note_id": note.id},
                distance=0.12,
            )
        ],
        init_db_first=False,
    )

    with TestClient(app) as client:
        response = client.get("/search", params={"q": "source", "category_id": category.id})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [note.id]
    assert FakeVectorStore.calls == [
        {"updated_chunks": [(note.id, 0)]},
        {
            "embedding": [0.1, 0.2, 0.3],
            "limit": 20,
            "where": {"category_scope": f"category:{category.id}"},
        },
    ]


def test_search_discards_semantic_hits_outside_selected_category(
    tmp_path: Path,
    monkeypatch,
) -> None:
    sqlite_path = _init_path(tmp_path)
    category = create_category(sqlite_path, "Projects")
    included = create_note(sqlite_path, "Included source note", category_id=category.id)
    excluded = create_note(sqlite_path, "Excluded source note")
    app = _search_app(
        tmp_path,
        monkeypatch,
        semantic_results=[
            VectorSearchResult(
                id="note:2:chunk:0",
                text="stale wrong category chunk",
                metadata={"note_id": excluded.id},
                distance=0.01,
            ),
            VectorSearchResult(
                id="note:1:chunk:0",
                text="correct category chunk",
                metadata={"note_id": included.id},
                distance=0.12,
            ),
        ],
        init_db_first=False,
    )

    with TestClient(app) as client:
        response = client.get("/search", params={"q": "source", "category_id": category.id})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [included.id]


def test_search_rejects_missing_category_scope(tmp_path: Path, monkeypatch) -> None:
    app = _search_app(tmp_path, monkeypatch, semantic_results=[])

    with TestClient(app) as client:
        response = client.get("/search", params={"q": "source", "category_id": 999999})

    assert response.status_code == 422
    assert response.json() == {"detail": "Category not found"}


def test_search_rejects_conflicting_category_scopes(tmp_path: Path, monkeypatch) -> None:
    app = _search_app(tmp_path, monkeypatch, semantic_results=[])

    with TestClient(app) as client:
        response = client.get(
            "/search",
            params={"q": "source", "category_id": 1, "uncategorized": "true"},
        )

    assert response.status_code == 422
    assert response.json() == {"detail": "category_id and uncategorized cannot both be set"}


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
