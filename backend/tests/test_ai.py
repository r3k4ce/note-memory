from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from mapping_memory.ai import (
    OrganizerMetadata,
    OrganizerResponseError,
    OrganizerUnavailableError,
    organize_mapping_text,
)
from mapping_memory.main import create_app
from mapping_memory.settings import Settings


class FakeCompletions:
    def __init__(self, parsed: OrganizerMetadata | None, refusal: str | None = None) -> None:
        self.parsed = parsed
        self.refusal = refusal
        self.calls: list[dict[str, Any]] = []

    def parse(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        message = SimpleNamespace(parsed=self.parsed, refusal=self.refusal)
        choice = SimpleNamespace(message=message)
        return SimpleNamespace(choices=[choice])


class FakeClient:
    def __init__(self, parsed: OrganizerMetadata | None, refusal: str | None = None) -> None:
        self.completions = FakeCompletions(parsed, refusal)
        self.chat = SimpleNamespace(completions=self.completions)


def test_organize_mapping_text_returns_validated_metadata() -> None:
    parsed = OrganizerMetadata(
        title="Route Planning Labels",
        summary="Notes describe how route labels should be grouped for retrieval.",
        tags=["routing", "labels", "retrieval"],
    )
    client = FakeClient(parsed)

    result = organize_mapping_text(
        "messy notes about route planning labels",
        settings=Settings(openai_api_key=None, openai_organizer_model="test-model"),
        client=client,
    )

    assert result == parsed
    assert client.completions.calls[0]["model"] == "test-model"
    assert client.completions.calls[0]["response_format"] is OrganizerMetadata
    assert client.completions.calls[0]["messages"][0]["role"] == "system"
    assert "do not invent facts" in client.completions.calls[0]["messages"][0]["content"].lower()
    assert (
        "messy notes about route planning labels"
        in client.completions.calls[0]["messages"][1]["content"]
    )


def test_organize_mapping_text_calls_openai_api_with_real_key() -> None:
    settings = Settings()
    if settings.openai_api_key is None:
        pytest.skip("OPENAI_API_KEY is not configured")

    result = organize_mapping_text(
        """
        Trail map note: use blue for water access points near River Road.
        Add retrieval tags for trailheads, water access, and River Road.
        Do not mention parking because this note does not include parking details.
        """,
        settings=settings,
    )

    assert result.title.strip()
    assert result.summary.strip()
    assert 0 <= len(result.tags) <= 10
    assert all(tag == tag.lower() for tag in result.tags)
    assert all(tag.strip() == tag for tag in result.tags)


def test_organize_mapping_text_rejects_missing_parsed_response() -> None:
    client = FakeClient(None, refusal="No valid output")

    with pytest.raises(OrganizerResponseError, match="valid organizer metadata"):
        organize_mapping_text(
            "mapping text",
            settings=Settings(openai_api_key=None),
            client=client,
        )


def test_organizer_metadata_rejects_invalid_output() -> None:
    with pytest.raises(ValidationError):
        OrganizerMetadata.model_validate(
            {
                "title": "Valid title",
                "summary": "Valid summary.",
                "tags": [
                    "one",
                    "two",
                    "three",
                    "four",
                    "five",
                    "six",
                    "seven",
                    "eight",
                    "nine",
                    "ten",
                    "eleven",
                ],
            }
        )

    with pytest.raises(ValidationError):
        OrganizerMetadata.model_validate(
            {"title": " ", "summary": "Valid summary.", "tags": ["retrieval"]}
        )

    with pytest.raises(ValidationError):
        OrganizerMetadata.model_validate(
            {
                "title": "Valid title",
                "summary": "Valid summary.",
                "tags": ["retrieval"],
                "confidence": 0.8,
            }
        )


def test_organizer_metadata_normalizes_tags() -> None:
    metadata = OrganizerMetadata(
        title="Tag Cleanup",
        summary="Notes describe expected tag cleanup.",
        tags=[" Routing ", "routing", "Memory", "retrieval  "],
    )

    assert metadata.tags == ["routing", "memory", "retrieval"]


def test_organizer_metadata_rejects_empty_tags() -> None:
    with pytest.raises(ValidationError):
        OrganizerMetadata(
            title="Tag Cleanup",
            summary="Notes describe expected tag cleanup.",
            tags=["routing", "  "],
        )


def test_missing_api_key_raises_without_crashing_app_layer(tmp_path: Path) -> None:
    settings = Settings(sqlite_path=tmp_path / "notes.sqlite", openai_api_key=None)
    app = create_app(settings)

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    with pytest.raises(OrganizerUnavailableError, match="OPENAI_API_KEY"):
        organize_mapping_text("mapping text", settings=settings)
