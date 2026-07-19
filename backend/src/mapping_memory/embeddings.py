from typing import Any

from mapping_memory.settings import Settings
from mapping_memory.voyage_embeddings import (
    EmbeddingProviderError,
    EmbeddingUnavailableError,
)
from mapping_memory.voyage_embeddings import (
    embed_documents as _embed_documents,
)
from mapping_memory.voyage_embeddings import (
    embed_query as _embed_query,
)

__all__ = [
    "EmbeddingProviderError",
    "EmbeddingUnavailableError",
    "embed_documents",
    "embed_query",
]


def embed_documents(
    texts: list[str],
    *,
    settings: Settings | None = None,
    client: Any | None = None,
) -> list[list[float]]:
    return _embed_documents(texts, settings=settings, client=client)


def embed_query(
    text: str,
    *,
    settings: Settings | None = None,
    client: Any | None = None,
) -> list[float]:
    return _embed_query(text, settings=settings, client=client)
