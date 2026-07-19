from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from mapping_memory.settings import Settings

CHROMA_INPUT_FORMAT_VERSION = "voyage-input-type-v1"
CHROMA_CHUNK_FORMAT_VERSION = "retrieval-chunk-v1"
MEMORY_CONFIGURATION_VERSION = "mem0-groq-voyage-v1"

ProviderFingerprint = dict[str, object]


def chroma_fingerprint_path(settings: Settings) -> Path:
    return settings.chroma_path / "index-provider.json"


def expected_chroma_fingerprint(settings: Settings) -> ProviderFingerprint:
    return {
        "embedding_provider": "voyage",
        "embedding_model": settings.voyage_embedding_model,
        "embedding_dimensions": settings.voyage_embedding_dimensions,
        "embedding_input_format_version": CHROMA_INPUT_FORMAT_VERSION,
        "chunk_format_version": CHROMA_CHUNK_FORMAT_VERSION,
    }


def chroma_fingerprint_compatible(settings: Settings) -> bool:
    return read_provider_fingerprint(chroma_fingerprint_path(settings)) == (
        expected_chroma_fingerprint(settings)
    )


def chroma_index_ready(settings: Settings) -> bool:
    return settings.voyage_api_key is not None and chroma_fingerprint_compatible(settings)


def memory_fingerprint_path(settings: Settings) -> Path:
    return settings.memory_path / "memory-provider.json"


def expected_memory_fingerprint(settings: Settings) -> ProviderFingerprint:
    return {
        "llm_provider": "groq",
        "llm_model": settings.groq_model,
        "embedding_provider": "voyage",
        "embedding_model": settings.voyage_embedding_model,
        "embedding_dimensions": settings.voyage_embedding_dimensions,
        "memory_configuration_version": MEMORY_CONFIGURATION_VERSION,
    }


def memory_fingerprint_compatible(settings: Settings) -> bool:
    return read_provider_fingerprint(memory_fingerprint_path(settings)) == (
        expected_memory_fingerprint(settings)
    )


def read_provider_fingerprint(path: Path) -> ProviderFingerprint | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def write_provider_fingerprint(path: Path, fingerprint: ProviderFingerprint) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as stream:
            json.dump(fingerprint, stream, sort_keys=True)
            stream.write("\n")
        temporary_path.replace(path)
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise


def remove_provider_fingerprint(path: Path) -> None:
    path.unlink(missing_ok=True)
