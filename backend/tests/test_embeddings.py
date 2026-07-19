from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from mapping_memory.main import create_app
from mapping_memory.settings import Settings


class FakeClient:
    def __init__(self, dimensions: int = 3) -> None:
        self.dimensions = dimensions
        self.calls: list[dict[str, Any]] = []

    def embed(self, texts: list[str], **kwargs: Any) -> SimpleNamespace:
        self.calls.append({"texts": list(texts), **kwargs})
        return SimpleNamespace(
            embeddings=[
                [float(index), *([0.25] * (self.dimensions - 1))] for index, _ in enumerate(texts)
            ]
        )


def test_embed_documents_uses_document_input_type_and_dimensions() -> None:
    from mapping_memory.embeddings import embed_documents

    client = FakeClient()
    result = embed_documents(
        ["first note", "second note"],
        settings=Settings(
            voyage_api_key=None,
            voyage_embedding_model="test-embedding-model",
            voyage_embedding_dimensions=3,
        ),
        client=client,
    )

    assert result == [[0.0, 0.25, 0.25], [1.0, 0.25, 0.25]]
    assert client.calls == [
        {
            "texts": ["first note", "second note"],
            "model": "test-embedding-model",
            "input_type": "document",
            "output_dimension": 3,
        }
    ]


def test_embed_query_uses_query_input_type() -> None:
    from mapping_memory.embeddings import embed_query

    client = FakeClient()
    result = embed_query(
        "find this note",
        settings=Settings(voyage_api_key=None, voyage_embedding_dimensions=3),
        client=client,
    )

    assert result == [0.0, 0.25, 0.25]
    assert client.calls[0]["input_type"] == "query"
    assert client.calls[0]["texts"] == ["find this note"]


def test_embed_documents_batches_at_64_and_preserves_batch_order() -> None:
    from mapping_memory.embeddings import embed_documents

    client = FakeClient()
    texts = [f"note {index}" for index in range(130)]

    result = embed_documents(
        texts,
        settings=Settings(voyage_api_key=None, voyage_embedding_dimensions=3),
        client=client,
    )

    assert [len(call["texts"]) for call in client.calls] == [64, 64, 2]
    assert result[0] == [0.0, 0.25, 0.25]
    assert result[63] == [63.0, 0.25, 0.25]
    assert result[64] == [0.0, 0.25, 0.25]
    assert result[-1] == [1.0, 0.25, 0.25]


@pytest.mark.parametrize("texts", [[], ["valid", " \n\t "]])
def test_embed_documents_rejects_empty_or_blank_inputs(texts: list[str]) -> None:
    from mapping_memory.embeddings import embed_documents

    with pytest.raises(ValueError, match=r"empty|blank"):
        embed_documents(
            texts,
            settings=Settings(voyage_api_key=None, voyage_embedding_dimensions=3),
            client=FakeClient(),
        )


def test_embed_query_rejects_blank_input() -> None:
    from mapping_memory.embeddings import embed_query

    with pytest.raises(ValueError, match="text must not be blank"):
        embed_query(
            "  ",
            settings=Settings(voyage_api_key=None, voyage_embedding_dimensions=3),
            client=FakeClient(),
        )


def test_embedding_dimension_mismatch_is_rejected() -> None:
    from mapping_memory.embeddings import EmbeddingProviderError, embed_documents

    with pytest.raises(EmbeddingProviderError, match="unexpected dimensions"):
        embed_documents(
            ["note"],
            settings=Settings(voyage_api_key=None, voyage_embedding_dimensions=4),
            client=FakeClient(dimensions=3),
        )


def test_embedding_provider_failure_is_sanitized() -> None:
    from mapping_memory.embeddings import EmbeddingProviderError, embed_documents

    class FailingClient:
        def embed(self, *_args: Any, **_kwargs: Any) -> None:
            raise RuntimeError("provider failure with sensitive details")

    with pytest.raises(
        EmbeddingProviderError, match="Voyage embeddings request failed"
    ) as exc_info:
        embed_documents(
            ["secret note text"],
            settings=Settings(voyage_api_key=None, voyage_embedding_dimensions=3),
            client=FailingClient(),
        )

    assert "sensitive" not in str(exc_info.value)
    assert "secret note text" not in str(exc_info.value)


def test_create_voyage_client_uses_timeout_retry_and_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from mapping_memory.voyage_embeddings import create_voyage_client

    captured: dict[str, Any] = {}

    class FakeVoyageClient:
        def __init__(self, **kwargs: Any) -> None:
            captured.update(kwargs)

    monkeypatch.setattr("voyageai.client.Client", FakeVoyageClient)

    create_voyage_client(
        Settings(
            voyage_api_key=SecretStr("voyage-secret"),
            voyage_timeout_seconds=19,
            voyage_max_retries=2,
        )
    )

    assert captured == {"api_key": "voyage-secret", "timeout": 19.0, "max_retries": 2}


def test_missing_voyage_key_raises_without_crashing_app_layer(tmp_path: Path) -> None:
    from mapping_memory.embeddings import EmbeddingUnavailableError, embed_query

    settings = Settings(sqlite_path=tmp_path / "notes.sqlite", voyage_api_key=None)
    app = create_app(settings)

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    with pytest.raises(EmbeddingUnavailableError, match="VOYAGE_API_KEY"):
        embed_query("mapping text", settings=settings)
