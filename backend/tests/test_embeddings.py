from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from openai import OpenAIError

from mapping_memory.embeddings import (
    EmbeddingProviderError,
    EmbeddingUnavailableError,
    embed_texts,
)
from mapping_memory.main import create_app
from mapping_memory.settings import Settings


class FakeEmbeddings:
    def __init__(self, data: list[SimpleNamespace] | None = None) -> None:
        self.data = data or []
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        return SimpleNamespace(data=self.data)


class FakeFailingEmbeddings:
    def create(self, **kwargs: Any) -> SimpleNamespace:
        raise OpenAIError("provider failure with sensitive details")


class FakeClient:
    def __init__(self, embeddings: FakeEmbeddings | FakeFailingEmbeddings) -> None:
        self.embeddings = embeddings


def test_embed_texts_returns_one_vector_from_mocked_response() -> None:
    embeddings = FakeEmbeddings([SimpleNamespace(index=0, embedding=[0.1, 0.2, 0.3])])
    client = FakeClient(embeddings)

    result = embed_texts(
        ["route label note"],
        settings=Settings(openai_api_key=None, openai_embedding_model="test-embedding-model"),
        client=client,
    )

    assert result == [[0.1, 0.2, 0.3]]
    assert embeddings.calls == [
        {
            "model": "test-embedding-model",
            "input": ["route label note"],
        }
    ]


def test_embed_texts_returns_multiple_vectors_in_input_order() -> None:
    embeddings = FakeEmbeddings(
        [
            SimpleNamespace(index=1, embedding=[0.4, 0.5]),
            SimpleNamespace(index=0, embedding=[0.1, 0.2]),
        ]
    )
    client = FakeClient(embeddings)

    result = embed_texts(
        ["first note", "second note"],
        settings=Settings(openai_api_key=None),
        client=client,
    )

    assert result == [[0.1, 0.2], [0.4, 0.5]]


def test_embed_texts_rejects_empty_or_blank_inputs() -> None:
    with pytest.raises(ValueError, match="texts must not be empty"):
        embed_texts([], settings=Settings(openai_api_key=None), client=FakeClient(FakeEmbeddings()))

    with pytest.raises(ValueError, match="texts must not contain blank values"):
        embed_texts(
            ["valid", " \n\t "],
            settings=Settings(openai_api_key=None),
            client=FakeClient(FakeEmbeddings()),
        )


def test_missing_api_key_raises_without_crashing_app_layer(tmp_path: Path) -> None:
    settings = Settings(sqlite_path=tmp_path / "notes.sqlite", openai_api_key=None)
    app = create_app(settings)

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    with pytest.raises(EmbeddingUnavailableError, match="OPENAI_API_KEY"):
        embed_texts(["mapping text"], settings=settings)


def test_openai_error_is_wrapped_with_generic_message() -> None:
    with pytest.raises(
        EmbeddingProviderError, match="OpenAI embeddings request failed"
    ) as exc_info:
        embed_texts(
            ["text that must not appear in errors"],
            settings=Settings(openai_api_key=None),
            client=FakeClient(FakeFailingEmbeddings()),
        )

    assert isinstance(exc_info.value.__cause__, OpenAIError)
    assert "text that must not appear in errors" not in str(exc_info.value)
    assert "provider failure" not in str(exc_info.value)


def test_note_creation_does_not_call_embeddings(tmp_path: Path, monkeypatch) -> None:
    def fail_if_called(*args: Any, **kwargs: Any) -> list[list[float]]:
        raise AssertionError("embeddings should not be wired into note creation")

    monkeypatch.setattr("mapping_memory.embeddings.embed_texts", fail_if_called, raising=False)
    app = create_app(Settings(sqlite_path=tmp_path / "notes.sqlite", openai_api_key=None))

    with TestClient(app) as client:
        response = client.post("/notes", json={"original_text": "Note title\nBody"})

    assert response.status_code == 201
    assert response.json()["ai_title"] == "Note title"
