import sys
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from mapping_memory.settings import Settings


class StructuredResult(BaseModel):
    value: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class FakeCompletions:
    def __init__(self, content: str | None = '{"value":"ok"}') -> None:
        self.content = content
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content, refusal=None))]
        )


def test_request_structured_output_uses_strict_schema_and_explicit_model_and_reasoning() -> None:
    from mapping_memory.groq_ai import request_structured_output

    completions = FakeCompletions()
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    settings = Settings(groq_api_key=None)

    result = request_structured_output(
        [{"role": "user", "content": "return data"}],
        StructuredResult,
        settings=settings,
        model="test-model",
        reasoning_effort="high",
        client=client,
    )

    assert result == StructuredResult(value="ok")
    call = completions.calls[0]
    assert call["model"] == "test-model"
    assert call["reasoning_effort"] == "high"
    assert call["response_format"] == {
        "type": "json_schema",
        "json_schema": {
            "name": "structured_result",
            "strict": True,
            "schema": StructuredResult.model_json_schema(),
        },
    }


@pytest.mark.parametrize("content", [None, "", "not json", '{"value": 3}', '{"value":""}'])
def test_request_structured_output_rejects_missing_or_invalid_data(content: str | None) -> None:
    from mapping_memory.groq_ai import GroqResponseError, request_structured_output

    client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions(content)))

    with pytest.raises(GroqResponseError, match="valid structured output"):
        request_structured_output(
            [{"role": "user", "content": "return data"}],
            StructuredResult,
            settings=Settings(groq_api_key=None),
            model="test-model",
            reasoning_effort="medium",
            client=client,
        )


def test_request_structured_output_translates_provider_failure() -> None:
    from mapping_memory.groq_ai import GroqProviderError, request_structured_output

    class FailingCompletions:
        def create(self, **_kwargs: Any) -> None:
            raise RuntimeError("provider response with sensitive details")

    client = SimpleNamespace(chat=SimpleNamespace(completions=FailingCompletions()))
    with pytest.raises(GroqProviderError, match="Groq request failed") as exc_info:
        request_structured_output(
            [{"role": "user", "content": "secret request body"}],
            StructuredResult,
            settings=Settings(groq_api_key=None),
            model="test-model",
            reasoning_effort="medium",
            client=client,
        )

    assert "sensitive" not in str(exc_info.value)
    assert "secret request body" not in str(exc_info.value)


def test_create_groq_client_uses_timeout_retry_and_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from mapping_memory.groq_ai import create_groq_client

    captured: dict[str, Any] = {}

    class FakeGroq:
        def __init__(self, **kwargs: Any) -> None:
            captured.update(kwargs)

    fake_module = ModuleType("groq")
    fake_module.Groq = FakeGroq  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "groq", fake_module)

    create_groq_client(
        Settings(
            groq_api_key=SecretStr("groq-secret"),
            groq_timeout_seconds=17,
            groq_max_retries=2,
        )
    )

    assert captured == {"api_key": "groq-secret", "timeout": 17.0, "max_retries": 2}


def test_create_groq_client_requires_key() -> None:
    from mapping_memory.groq_ai import GroqUnavailableError, create_groq_client

    with pytest.raises(GroqUnavailableError, match="GROQ_API_KEY"):
        create_groq_client(Settings(groq_api_key=None))
