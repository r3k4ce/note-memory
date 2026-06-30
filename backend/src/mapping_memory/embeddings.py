from typing import Any

from openai import OpenAI, OpenAIError

from mapping_memory.settings import Settings


class EmbeddingUnavailableError(RuntimeError):
    """Raised when embeddings cannot be called in the current environment."""


class EmbeddingProviderError(RuntimeError):
    """Raised when the embeddings provider fails."""


def embed_texts(
    texts: list[str],
    *,
    settings: Settings | None = None,
    client: Any | None = None,
) -> list[list[float]]:
    if not texts:
        raise ValueError("texts must not be empty")
    if any(not text.strip() for text in texts):
        raise ValueError("texts must not contain blank values")

    app_settings = settings or Settings()
    embeddings_client = client or _openai_client(app_settings)
    try:
        response = embeddings_client.embeddings.create(
            model=app_settings.openai_embedding_model,
            input=texts,
        )
    except OpenAIError as error:
        raise EmbeddingProviderError("OpenAI embeddings request failed") from error

    ordered_data = sorted(response.data, key=lambda item: item.index)
    return [list(item.embedding) for item in ordered_data]


def _openai_client(settings: Settings) -> OpenAI:
    if settings.openai_api_key is None:
        raise EmbeddingUnavailableError("OPENAI_API_KEY is required to embed text")

    return OpenAI(api_key=settings.openai_api_key.get_secret_value())
