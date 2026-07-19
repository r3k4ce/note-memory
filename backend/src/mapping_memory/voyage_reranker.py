from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Protocol

from mapping_memory.settings import Settings
from mapping_memory.voyage_embeddings import create_voyage_client


class RerankCandidate(Protocol):
    @property
    def text(self) -> str: ...


class RerankerProviderError(RuntimeError):
    """Raised when the Voyage reranker request fails."""


class RerankerResponseError(RuntimeError):
    """Raised when Voyage returns an invalid reranking response."""


def rerank_chunks[Candidate: RerankCandidate](
    query: str,
    candidates: Sequence[Candidate],
    *,
    settings: Settings | None = None,
    client: Any | None = None,
) -> list[Candidate]:
    if not query.strip():
        raise ValueError("query must not be blank")
    if not candidates:
        return []
    if any(not candidate.text.strip() for candidate in candidates):
        raise ValueError("candidate text must not be blank")

    app_settings = settings or Settings()
    voyage_client = client or create_voyage_client(app_settings)
    try:
        response = voyage_client.rerank(
            query=query,
            documents=[candidate.text for candidate in candidates],
            model=app_settings.voyage_reranker_model,
            top_k=len(candidates),
        )
    except Exception as error:
        raise RerankerProviderError("Voyage reranking request failed") from error

    raw_results = getattr(response, "results", None)
    if not isinstance(raw_results, list) or len(raw_results) != len(candidates):
        raise RerankerResponseError("Voyage returned invalid reranking output")

    indices: list[int] = []
    for result in raw_results:
        index = getattr(result, "index", None)
        if (
            isinstance(index, bool)
            or not isinstance(index, int)
            or index < 0
            or index >= len(candidates)
        ):
            raise RerankerResponseError("Voyage returned invalid reranking output")
        indices.append(index)
    if len(set(indices)) != len(candidates):
        raise RerankerResponseError("Voyage returned invalid reranking output")

    return [candidates[index] for index in indices]
