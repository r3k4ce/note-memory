from typing import Any

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, field_validator

from mapping_memory.settings import Settings

ORGANIZER_SYSTEM_PROMPT = """Organize messy mapping-work notes into clean reference cards.
Return only valid JSON.
Do not invent facts.
Title should be specific and practical.
Summary should be 1-3 sentences.
Tags should be lowercase.
Use 3-10 tags when possible.
Prefer concrete retrieval tags."""


class OrganizerUnavailableError(RuntimeError):
    """Raised when the organizer cannot be called in the current environment."""


class OrganizerResponseError(RuntimeError):
    """Raised when the model does not return usable organizer metadata."""


class OrganizerMetadata(BaseModel):
    title: str
    summary: str
    tags: list[str]

    model_config = ConfigDict(extra="forbid")

    @field_validator("title", "summary")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("value must not be blank")

        return stripped_value

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("tags must be a list")

        normalized_tags: list[str] = []
        seen_tags: set[str] = set()
        for tag in value:
            if not isinstance(tag, str):
                raise ValueError("tags must be strings")

            normalized_tag = tag.strip().lower()
            if not normalized_tag:
                raise ValueError("tags must not be blank")
            if normalized_tag in seen_tags:
                continue

            normalized_tags.append(normalized_tag)
            seen_tags.add(normalized_tag)

        if len(normalized_tags) > 10:
            raise ValueError("tags must contain at most 10 values")

        return normalized_tags


def organize_mapping_text(
    original_text: str,
    *,
    settings: Settings | None = None,
    client: Any | None = None,
) -> OrganizerMetadata:
    if not original_text.strip():
        raise ValueError("original_text must not be empty")

    app_settings = settings or Settings()
    organizer_client = client or _openai_client(app_settings)
    completion = organizer_client.chat.completions.parse(
        model=app_settings.openai_organizer_model,
        messages=[
            {"role": "system", "content": ORGANIZER_SYSTEM_PROMPT},
            {"role": "user", "content": f"Original mapping text:\n\n{original_text}"},
        ],
        response_format=OrganizerMetadata,
    )
    message = completion.choices[0].message
    parsed = message.parsed
    if parsed is None:
        raise OrganizerResponseError("OpenAI did not return valid organizer metadata")

    return parsed


def _openai_client(settings: Settings) -> OpenAI:
    if settings.openai_api_key is None:
        raise OrganizerUnavailableError("OPENAI_API_KEY is required to organize mapping text")

    return OpenAI(api_key=settings.openai_api_key.get_secret_value())
