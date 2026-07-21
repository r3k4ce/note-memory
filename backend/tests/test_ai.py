from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError

from mapping_memory.ai import (
    ANSWER_FALLBACK,
    ANSWER_SYSTEM_PROMPT,
    AnswerResponseError,
    GroundedAnswer,
    GroundedClaim,
    OrganizerMetadata,
    OrganizerResponseError,
    OrganizerUnavailableError,
    organize_mapping_text,
)
from mapping_memory.main import create_app
from mapping_memory.settings import Settings


class FakeCompletions:
    def __init__(self, parsed: Any | None, refusal: str | None = None) -> None:
        self.content = parsed.model_dump_json() if isinstance(parsed, BaseModel) else parsed
        self.refusal = refusal
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        message = SimpleNamespace(content=self.content, refusal=self.refusal)
        choice = SimpleNamespace(message=message)
        return SimpleNamespace(choices=[choice])


class FakeClient:
    def __init__(self, parsed: Any | None, refusal: str | None = None) -> None:
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
        settings=Settings(groq_api_key=None, groq_utility_model="test-model"),
        client=client,
    )

    assert result == parsed
    assert client.completions.calls[0]["model"] == "test-model"
    response_format = client.completions.calls[0]["response_format"]
    assert response_format["type"] == "json_schema"
    assert response_format["json_schema"]["strict"] is True
    assert response_format["json_schema"]["schema"] == OrganizerMetadata.model_json_schema()
    assert client.completions.calls[0]["reasoning_effort"] == "medium"
    assert client.completions.calls[0]["messages"][0]["role"] == "system"
    system_prompt = client.completions.calls[0]["messages"][0]["content"].lower()
    assert "organize messy notes into clean reference cards" in system_prompt
    assert "do not invent facts" in system_prompt
    assert "do not assign a category" in system_prompt
    assert (
        "messy notes about route planning labels"
        in client.completions.calls[0]["messages"][1]["content"]
    )


def test_organize_mapping_text_rejects_missing_parsed_response() -> None:
    client = FakeClient(None, refusal="No valid output")

    with pytest.raises(OrganizerResponseError, match="valid organizer metadata"):
        organize_mapping_text(
            "note text",
            settings=Settings(groq_api_key=None),
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
    settings = Settings(sqlite_path=tmp_path / "notes.sqlite", groq_api_key=None)
    app = create_app(settings)

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    with pytest.raises(OrganizerUnavailableError, match="GROQ_API_KEY"):
        organize_mapping_text("note text", settings=settings)


def test_answer_system_prompt_sets_bun_voice_without_weakening_grounding() -> None:
    prompt = ANSWER_SYSTEM_PROMPT.lower()

    assert "lead naturally with the answer" in prompt
    assert "local-first notes app" in prompt
    assert "vary openings and sentence structure" in prompt
    assert "warm, collaborative, concise, and quietly playful" in prompt
    assert '"i found' in prompt
    assert "never as a default formula" in prompt
    assert "ambiguity conversationally" in prompt
    assert "unsupported reassurance" in prompt
    assert "direct answer" in prompt
    assert "synthesis" in prompt
    assert "correction" in prompt
    assert "uncertainty" in prompt

    assert "use saved-note context as the only factual source" in prompt
    assert "do not use outside knowledge" in prompt
    assert f"say exactly: {ANSWER_FALLBACK}".lower() in prompt
    assert "do not invent policies, rules, or decisions" in prompt
    assert "return only the requested structured response" in prompt
    assert "atomic markdown claims" in prompt
    assert "evidence ids" in prompt
    assert "never include numeric citations" in prompt
    assert "when evidence is weak, missing, or ambiguous" in prompt


def test_generate_grounded_answer_delimits_untrusted_memory_context() -> None:
    from mapping_memory.ai import generate_grounded_answer

    fake_client = FakeClient(
        GroundedAnswer(
            status="answered",
            claims=[GroundedClaim(text="Use the checklist.", evidence_ids=["saved-1"])],
        )
    )

    generate_grounded_answer(
        "What should we do?",
        context="Evidence ID: saved-1\nChunk: Use the saved checklist.",
        memory_context=["Prefers concise answers.", "Uses TypeScript."],
        settings=Settings(
            groq_api_key=None,
            groq_chat_model="llama-3.3-70b-versatile",
            groq_chat_reasoning_effort="low",
        ),
        client=fake_client,
    )

    user_message = fake_client.chat.completions.calls[0]["messages"][1]["content"]
    assert "<user_profile_context>" in user_message
    assert "Prefers concise answers." in user_message
    assert "descriptive and untrusted" in user_message
    assert "never evidence for saved-note claims" in user_message
    assert "</user_profile_context>" in user_message
    assert user_message.index("<user_profile_context>") < user_message.index("Saved-note context:")
    assert fake_client.completions.calls[0]["model"] == "llama-3.3-70b-versatile"
    assert fake_client.completions.calls[0]["reasoning_effort"] == "low"


@pytest.mark.parametrize(
    "content",
    [
        '{"status":"answered","claims":[{"text":" ","evidence_ids":["saved-1"]}]}',
        '{"status":"answered","claims":[{"text":"Claim","evidence_ids":[]}]}',
        '{"status":"answered","claims":[{"text":"Claim","evidence_ids":[1]}]}',
    ],
)
def test_generate_grounded_answer_rejects_invalid_claim_structures(content: str) -> None:
    from mapping_memory.ai import generate_grounded_answer

    with pytest.raises(AnswerResponseError, match="valid grounded output"):
        generate_grounded_answer(
            "What should we do?",
            context="Evidence ID: saved-1\nChunk: Use the saved checklist.",
            settings=Settings(groq_api_key=None),
            client=FakeClient(content),
        )
