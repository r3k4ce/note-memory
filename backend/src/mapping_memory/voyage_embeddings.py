from __future__ import annotations

from typing import Any, Literal

from mapping_memory.settings import Settings

DOCUMENT_BATCH_SIZE = 64


class EmbeddingUnavailableError(RuntimeError):
    """Raised when Voyage embeddings cannot be configured."""


class EmbeddingProviderError(RuntimeError):
    """Raised when Voyage returns unusable embeddings."""


def create_voyage_client(settings: Settings) -> Any:
    api_key = settings.voyage_api_key
    if api_key is None:
        raise EmbeddingUnavailableError("VOYAGE_API_KEY is required to embed text")

    from voyageai.client import Client

    return Client(
        api_key=api_key.get_secret_value(),
        timeout=settings.voyage_timeout_seconds,
        max_retries=settings.voyage_max_retries,
    )


def embed_documents(
    texts: list[str],
    *,
    settings: Settings | None = None,
    client: Any | None = None,
) -> list[list[float]]:
    _validate_texts(texts)
    app_settings = settings or Settings()
    voyage_client = client or create_voyage_client(app_settings)
    embeddings: list[list[float]] = []
    for batch_start in range(0, len(texts), DOCUMENT_BATCH_SIZE):
        batch = texts[batch_start : batch_start + DOCUMENT_BATCH_SIZE]
        embeddings.extend(
            _embed_batch(
                batch,
                input_type="document",
                settings=app_settings,
                client=voyage_client,
            )
        )
    return embeddings


def embed_query(
    text: str,
    *,
    settings: Settings | None = None,
    client: Any | None = None,
) -> list[float]:
    if not text.strip():
        raise ValueError("text must not be blank")
    app_settings = settings or Settings()
    voyage_client = client or create_voyage_client(app_settings)
    return _embed_batch([text], input_type="query", settings=app_settings, client=voyage_client)[0]


def _embed_batch(
    texts: list[str],
    *,
    input_type: Literal["document", "query"],
    settings: Settings,
    client: Any,
) -> list[list[float]]:
    try:
        response = client.embed(
            texts,
            model=settings.voyage_embedding_model,
            input_type=input_type,
            output_dimension=settings.voyage_embedding_dimensions,
        )
    except Exception as error:
        raise EmbeddingProviderError("Voyage embeddings request failed") from error

    raw_embeddings = getattr(response, "embeddings", None)
    if not isinstance(raw_embeddings, list) or len(raw_embeddings) != len(texts):
        raise EmbeddingProviderError("Voyage returned an invalid embeddings response")

    embeddings: list[list[float]] = []
    for raw_embedding in raw_embeddings:
        if not isinstance(raw_embedding, list):
            raise EmbeddingProviderError("Voyage returned an invalid embeddings response")
        embedding = list(raw_embedding)
        if len(embedding) != settings.voyage_embedding_dimensions:
            raise EmbeddingProviderError("Voyage returned embeddings with unexpected dimensions")
        embeddings.append(embedding)
    return embeddings


def _validate_texts(texts: list[str]) -> None:
    if not texts:
        raise ValueError("texts must not be empty")
    if any(not text.strip() for text in texts):
        raise ValueError("texts must not contain blank values")
