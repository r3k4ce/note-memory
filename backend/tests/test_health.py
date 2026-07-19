from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from mapping_memory.main import create_app
from mapping_memory.provider_fingerprint import (
    chroma_fingerprint_path,
    expected_chroma_fingerprint,
    write_provider_fingerprint,
)
from mapping_memory.settings import Settings


def test_blank_provider_keys_are_unconfigured() -> None:
    settings = Settings(groq_api_key=SecretStr(" "), voyage_api_key=SecretStr(""))

    assert settings.groq_api_key is None
    assert settings.voyage_api_key is None


@pytest.mark.parametrize(
    ("groq", "voyage", "expected"),
    [
        (
            False,
            False,
            {
                "groq": False,
                "voyage": False,
                "organization": False,
                "semantic_search": False,
                "ask": False,
                "reranking": False,
                "memory": False,
            },
        ),
        (
            True,
            False,
            {
                "groq": True,
                "voyage": False,
                "organization": True,
                "semantic_search": False,
                "ask": True,
                "reranking": False,
                "memory": False,
            },
        ),
        (
            False,
            True,
            {
                "groq": False,
                "voyage": True,
                "organization": False,
                "semantic_search": True,
                "ask": False,
                "reranking": True,
                "memory": False,
            },
        ),
        (
            True,
            True,
            {
                "groq": True,
                "voyage": True,
                "organization": True,
                "semantic_search": True,
                "ask": True,
                "reranking": True,
                "memory": True,
            },
        ),
    ],
)
def test_health_returns_capability_matrix(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    groq: bool,
    voyage: bool,
    expected: dict[str, bool],
) -> None:
    settings = Settings(
        sqlite_path=tmp_path / "health.sqlite",
        vault_path=tmp_path / "vault",
        chroma_path=tmp_path / "chroma",
        memory_path=tmp_path / "memory",
        groq_api_key=SecretStr("groq-key") if groq else None,
        voyage_api_key=SecretStr("voyage-key") if voyage else None,
    )
    if voyage:
        write_provider_fingerprint(
            chroma_fingerprint_path(settings), expected_chroma_fingerprint(settings)
        )
    monkeypatch.setattr("mapping_memory.memory.MemoryAdapter._memory", lambda self: object())
    app = create_app(settings)

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "capabilities": expected}
