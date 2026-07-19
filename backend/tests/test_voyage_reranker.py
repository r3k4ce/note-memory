from types import SimpleNamespace
from typing import Any

import pytest

from mapping_memory.settings import Settings
from mapping_memory.vector_store import VectorSearchResult


class FakeRerankClient:
    def __init__(self, indices: list[int]) -> None:
        self.indices = indices
        self.calls: list[dict[str, Any]] = []

    def rerank(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        return SimpleNamespace(results=[SimpleNamespace(index=index) for index in self.indices])


def _candidate(index: int) -> VectorSearchResult:
    return VectorSearchResult(
        id=f"chunk-{index}",
        text=(
            f"Title: Note {index}\nTags: test\nDate added: 2026-07-18\n"
            f"Summary: Summary {index}\nChunk: Complete body {index}"
        ),
        metadata={"note_id": index, "chunk_index": 0},
        distance=float(index),
    )


def test_rerank_chunks_reorders_candidates_and_preserves_metadata() -> None:
    from mapping_memory.voyage_reranker import rerank_chunks

    candidates = [_candidate(1), _candidate(2), _candidate(3)]
    client = FakeRerankClient([2, 0, 1])
    result = rerank_chunks(
        "history-aware retrieval query",
        candidates,
        settings=Settings(voyage_api_key=None, voyage_reranker_model="test-reranker"),
        client=client,
    )

    assert result == [candidates[2], candidates[0], candidates[1]]
    assert result[0].metadata == candidates[2].metadata
    assert client.calls == [
        {
            "query": "history-aware retrieval query",
            "documents": [candidate.text for candidate in candidates],
            "model": "test-reranker",
            "top_k": 3,
        }
    ]


def test_rerank_chunks_rejects_invalid_response_indices() -> None:
    from mapping_memory.voyage_reranker import RerankerResponseError, rerank_chunks

    with pytest.raises(RerankerResponseError, match="invalid reranking output"):
        rerank_chunks(
            "query",
            [_candidate(1), _candidate(2)],
            settings=Settings(voyage_api_key=None),
            client=FakeRerankClient([0, 0]),
        )


def test_rerank_chunks_translates_provider_failure() -> None:
    from mapping_memory.voyage_reranker import RerankerProviderError, rerank_chunks

    class FailingClient:
        def rerank(self, **_kwargs: Any) -> None:
            raise RuntimeError("provider failure with sensitive details")

    with pytest.raises(RerankerProviderError, match="Voyage reranking request failed") as exc_info:
        rerank_chunks(
            "secret query",
            [_candidate(1)],
            settings=Settings(voyage_api_key=None),
            client=FailingClient(),
        )

    assert "sensitive" not in str(exc_info.value)
    assert "secret query" not in str(exc_info.value)


def test_rerank_chunks_returns_empty_without_calling_provider() -> None:
    from mapping_memory.voyage_reranker import rerank_chunks

    assert rerank_chunks("query", [], settings=Settings(voyage_api_key=None)) == []
