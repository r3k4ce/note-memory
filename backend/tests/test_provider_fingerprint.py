import json
from pathlib import Path

import pytest
from pydantic import SecretStr

from mapping_memory.settings import Settings


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        chroma_path=tmp_path / "chroma",
        voyage_api_key=SecretStr("test-voyage-key"),
        voyage_embedding_model="voyage-test",
        voyage_embedding_dimensions=1024,
    )


def test_compatible_chroma_fingerprint_is_ready(tmp_path: Path) -> None:
    from mapping_memory.provider_fingerprint import (
        chroma_fingerprint_path,
        chroma_index_ready,
        expected_chroma_fingerprint,
        write_provider_fingerprint,
    )

    settings = _settings(tmp_path)
    write_provider_fingerprint(
        chroma_fingerprint_path(settings), expected_chroma_fingerprint(settings)
    )

    assert chroma_index_ready(settings) is True
    assert json.loads(chroma_fingerprint_path(settings).read_text()) == {
        "embedding_provider": "voyage",
        "embedding_model": "voyage-test",
        "embedding_dimensions": 1024,
        "embedding_input_format_version": "voyage-input-type-v1",
        "chunk_format_version": "retrieval-chunk-v1",
    }


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("embedding_provider", "openai"),
        ("embedding_model", "legacy-model"),
        ("embedding_dimensions", 1536),
        ("embedding_input_format_version", "legacy-input"),
        ("chunk_format_version", "legacy-chunks"),
    ],
)
def test_mismatched_chroma_fingerprint_is_incompatible(
    tmp_path: Path, field: str, value: object
) -> None:
    from mapping_memory.provider_fingerprint import (
        chroma_fingerprint_compatible,
        chroma_fingerprint_path,
        expected_chroma_fingerprint,
    )

    settings = _settings(tmp_path)
    fingerprint = expected_chroma_fingerprint(settings)
    fingerprint[field] = value
    path = chroma_fingerprint_path(settings)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(fingerprint))

    assert chroma_fingerprint_compatible(settings) is False


def test_missing_or_invalid_chroma_fingerprint_is_not_ready(tmp_path: Path) -> None:
    from mapping_memory.provider_fingerprint import chroma_fingerprint_path, chroma_index_ready

    settings = _settings(tmp_path)
    assert chroma_index_ready(settings) is False

    path = chroma_fingerprint_path(settings)
    path.parent.mkdir(parents=True)
    path.write_text("not-json")
    assert chroma_index_ready(settings) is False


def test_chroma_index_requires_voyage_key_even_with_compatible_fingerprint(tmp_path: Path) -> None:
    from mapping_memory.provider_fingerprint import (
        chroma_fingerprint_path,
        chroma_index_ready,
        expected_chroma_fingerprint,
        write_provider_fingerprint,
    )

    configured = _settings(tmp_path)
    write_provider_fingerprint(
        chroma_fingerprint_path(configured), expected_chroma_fingerprint(configured)
    )

    assert chroma_index_ready(configured.model_copy(update={"voyage_api_key": None})) is False
