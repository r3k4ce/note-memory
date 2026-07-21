from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel

from mapping_memory.settings import Settings


class GroqUnavailableError(RuntimeError):
    """Raised when Groq cannot be configured."""


class GroqProviderError(RuntimeError):
    """Raised when the Groq SDK request fails."""


class GroqResponseError(RuntimeError):
    """Raised when Groq returns unusable structured output."""


def create_groq_client(settings: Settings) -> Any:
    api_key = settings.groq_api_key
    if api_key is None:
        raise GroqUnavailableError("GROQ_API_KEY is required")

    from groq import Groq

    return Groq(
        api_key=api_key.get_secret_value(),
        timeout=settings.groq_timeout_seconds,
        max_retries=settings.groq_max_retries,
    )


def request_structured_output[StructuredModel: BaseModel](
    messages: list[dict[str, str]],
    response_model: type[StructuredModel],
    *,
    settings: Settings,
    model: str,
    reasoning_effort: str,
    client: Any | None = None,
) -> StructuredModel:
    groq_client = client or create_groq_client(settings)
    try:
        completion = groq_client.chat.completions.create(
            model=model,
            messages=messages,
            reasoning_effort=reasoning_effort,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": _schema_name(response_model.__name__),
                    "strict": True,
                    "schema": response_model.model_json_schema(),
                },
            },
        )
    except Exception as error:
        raise GroqProviderError("Groq request failed") from error

    try:
        content = completion.choices[0].message.content
        if not isinstance(content, str) or not content.strip():
            raise ValueError("missing structured output")
        return response_model.model_validate_json(content)
    except (AttributeError, IndexError, TypeError, ValueError) as error:
        raise GroqResponseError("Groq did not return valid structured output") from error


def _schema_name(model_name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", model_name).lower()
