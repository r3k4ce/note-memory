import sys
from collections.abc import Iterator
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from mapping_memory.settings import Settings


class StructuredResult(BaseModel):
    value: str = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class FakeCompletions:
    def __init__(self, response: Any | None = None) -> None:
        self.response = response if response is not None else completion()
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        if isinstance(self.response, Exception):
            raise self.response
        return self.response


class FakeStream(Iterator[Any]):
    def __init__(self, chunks: list[Any]) -> None:
        self.chunks = iter(chunks)
        self.close_calls = 0

    def __next__(self) -> Any:
        return next(self.chunks)

    def close(self) -> None:
        self.close_calls += 1


def completion(
    *,
    content: str | None = "ordinary response",
    tool_calls: list[Any] | None = None,
    finish_reason: str | None = "stop",
) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(content=content, tool_calls=tool_calls),
                finish_reason=finish_reason,
            )
        ]
    )


def fake_client(response: Any | None = None) -> tuple[Any, FakeCompletions]:
    completions = FakeCompletions(response)
    return SimpleNamespace(chat=SimpleNamespace(completions=completions)), completions


@pytest.mark.parametrize(
    ("role", "model", "reasoning_effort"),
    [
        ("chat", "llama-3.3-70b-versatile", "low"),
        ("utility", "utility-model", "medium"),
        ("validation", "validation-model", "high"),
        ("web", "web-model", "low"),
    ],
)
def test_request_chat_completion_maps_each_role_to_its_settings(
    role: str, model: str, reasoning_effort: str
) -> None:
    from mapping_memory.groq_ai import GroqChatRequest, request_chat_completion

    client, completions = fake_client()
    settings = Settings(
        groq_api_key=None,
        groq_chat_model="llama-3.3-70b-versatile",
        groq_chat_reasoning_effort="low",
        groq_utility_model="utility-model",
        groq_utility_reasoning_effort="medium",
        groq_validation_model="validation-model",
        groq_validation_reasoning_effort="high",
        groq_web_model="web-model",
        groq_web_reasoning_effort="low",
    )

    result = request_chat_completion(
        GroqChatRequest(role=role, messages=[{"role": "user", "content": "hello"}]),  # type: ignore[arg-type]
        settings=settings,
        client=client,
    )

    assert result.content == "ordinary response"
    assert result.tool_calls == ()
    assert completions.calls[0] == {
        "model": model,
        "messages": [{"role": "user", "content": "hello"}],
        "reasoning_effort": reasoning_effort,
    }


def test_request_chat_completion_parses_content_and_function_tool_calls() -> None:
    from mapping_memory.groq_ai import GroqChatRequest, GroqToolCall, request_chat_completion

    tool_call = SimpleNamespace(
        id="call-1",
        function=SimpleNamespace(name="lookup_note", arguments='{"note_id":"note-1"}'),
    )
    client, completions = fake_client(
        completion(content=None, tool_calls=[tool_call], finish_reason="tool_calls")
    )
    request = GroqChatRequest(
        role="chat",
        messages=[{"role": "user", "content": "look it up"}],
        tools=[{"type": "function", "function": {"name": "lookup_note"}}],
        tool_choice="auto",
        parallel_tool_calls=False,
    )

    result = request_chat_completion(request, settings=Settings(groq_api_key=None), client=client)

    assert result.content is None
    assert result.tool_calls == (
        GroqToolCall(id="call-1", name="lookup_note", arguments={"note_id": "note-1"}),
    )
    assert result.finish_reason == "tool_calls"
    assert completions.calls[0]["tools"] == request.tools
    assert completions.calls[0]["tool_choice"] == "auto"
    assert completions.calls[0]["parallel_tool_calls"] is False


@pytest.mark.parametrize(
    "response",
    [
        SimpleNamespace(choices=[]),
        completion(content=" "),
        completion(content=None),
        completion(
            content=None,
            tool_calls=[
                SimpleNamespace(id=" ", function=SimpleNamespace(name="tool", arguments="{}"))
            ],
        ),
        completion(
            content=None,
            tool_calls=[
                SimpleNamespace(id="call", function=SimpleNamespace(name=" ", arguments="{}"))
            ],
        ),
        completion(
            content=None,
            tool_calls=[
                SimpleNamespace(id="call", function=SimpleNamespace(name="tool", arguments="{"))
            ],
        ),
        completion(
            content=None,
            tool_calls=[
                SimpleNamespace(id="call", function=SimpleNamespace(name="tool", arguments="[]"))
            ],
        ),
    ],
)
def test_request_chat_completion_rejects_unusable_responses(response: Any) -> None:
    from mapping_memory.groq_ai import GroqChatRequest, GroqResponseError, request_chat_completion

    client, _ = fake_client(response)
    with pytest.raises(GroqResponseError, match="Groq did not return a valid chat completion"):
        request_chat_completion(
            GroqChatRequest(role="chat", messages=[{"role": "user", "content": "hello"}]),
            settings=Settings(groq_api_key=None),
            client=client,
        )


def test_stream_chat_completion_forwards_raw_chunks_and_closes_once() -> None:
    from mapping_memory.groq_ai import GroqChatRequest, stream_chat_completion

    chunks = [SimpleNamespace(id="one"), SimpleNamespace(id="two")]
    stream = FakeStream(chunks)
    client, completions = fake_client(stream)

    result = stream_chat_completion(
        GroqChatRequest(role="utility", messages=[{"role": "user", "content": "hello"}]),
        settings=Settings(groq_api_key=None),
        client=client,
    )

    assert list(result) == chunks
    result.close()
    result.close()
    assert stream.close_calls == 1
    assert completions.calls[0]["stream"] is True


def test_stream_cancel_closes_once_and_stops_between_chunks() -> None:
    from mapping_memory.groq_ai import GroqAbort, GroqChatRequest, stream_chat_completion

    stream = FakeStream([SimpleNamespace(id="one"), SimpleNamespace(id="two")])
    client, _ = fake_client(stream)
    abort = GroqAbort()
    result = stream_chat_completion(
        GroqChatRequest(role="chat", messages=[{"role": "user", "content": "hello"}]),
        settings=Settings(groq_api_key=None),
        client=client,
        abort=abort,
    )

    assert next(result).id == "one"
    abort.cancel()
    assert list(result) == []
    result.cancel()
    assert stream.close_calls == 1


@pytest.mark.parametrize("streaming", [False, True])
def test_pre_cancelled_requests_do_not_call_the_provider(streaming: bool) -> None:
    from mapping_memory.groq_ai import (
        GroqAbort,
        GroqCancelledError,
        GroqChatRequest,
        request_chat_completion,
        stream_chat_completion,
    )

    client, completions = fake_client()
    abort = GroqAbort()
    abort.cancel()
    request = GroqChatRequest(role="chat", messages=[{"role": "user", "content": "hello"}])

    if streaming:
        with pytest.raises(GroqCancelledError, match="Groq request cancelled"):
            stream_chat_completion(
                request, settings=Settings(groq_api_key=None), client=client, abort=abort
            )
    else:
        with pytest.raises(GroqCancelledError, match="Groq request cancelled"):
            request_chat_completion(
                request, settings=Settings(groq_api_key=None), client=client, abort=abort
            )
    assert completions.calls == []


def test_request_structured_output_uses_role_schema_and_validates_json() -> None:
    from mapping_memory.groq_ai import request_structured_output

    client, completions = fake_client(completion(content='{"value":"ok"}'))
    result = request_structured_output(
        [{"role": "user", "content": "return data"}],
        StructuredResult,
        role="validation",
        settings=Settings(groq_api_key=None, groq_validation_model="validation-model"),
        client=client,
    )

    assert result == StructuredResult(value="ok")
    assert completions.calls[0]["model"] == "validation-model"
    assert completions.calls[0]["reasoning_effort"] == "medium"
    assert completions.calls[0]["response_format"] == {
        "type": "json_schema",
        "json_schema": {
            "name": "structured_result",
            "strict": True,
            "schema": StructuredResult.model_json_schema(),
        },
    }
    assert "stream" not in completions.calls[0]
    assert "tools" not in completions.calls[0]


def test_pre_cancelled_structured_request_does_not_call_the_provider() -> None:
    from mapping_memory.groq_ai import GroqAbort, GroqCancelledError, request_structured_output

    client, completions = fake_client()
    abort = GroqAbort()
    abort.cancel()

    with pytest.raises(GroqCancelledError, match="Groq request cancelled"):
        request_structured_output(
            [{"role": "user", "content": "return data"}],
            StructuredResult,
            role="utility",
            settings=Settings(groq_api_key=None),
            client=client,
            abort=abort,
        )
    assert completions.calls == []


@pytest.mark.parametrize("content", [None, "", "not json", '{"value": 3}', '{"value":""}'])
def test_request_structured_output_rejects_missing_or_invalid_data(content: str | None) -> None:
    from mapping_memory.groq_ai import GroqResponseError, request_structured_output

    client, _ = fake_client(completion(content=content))
    with pytest.raises(GroqResponseError, match="valid structured output"):
        request_structured_output(
            [{"role": "user", "content": "return data"}],
            StructuredResult,
            role="utility",
            settings=Settings(groq_api_key=None),
            client=client,
        )


@pytest.mark.parametrize(
    ("error", "expected_type", "message"),
    [
        (
            type("RateLimitError", (Exception,), {})("secret provider body"),
            "GroqRateLimitError",
            "Groq rate limit exceeded",
        ),
        (
            type("APITimeoutError", (Exception,), {})("secret provider body"),
            "GroqTimeoutError",
            "Groq request timed out",
        ),
        (RuntimeError("secret provider body"), "GroqProviderError", "Groq request failed"),
    ],
)
def test_provider_failures_are_normalized_without_sensitive_chains(
    error: Exception, expected_type: str, message: str
) -> None:
    from mapping_memory import groq_ai

    client, _ = fake_client(error)
    with pytest.raises(getattr(groq_ai, expected_type), match=message) as exc_info:
        groq_ai.request_chat_completion(
            groq_ai.GroqChatRequest(
                role="chat", messages=[{"role": "user", "content": "secret request body"}]
            ),
            settings=Settings(groq_api_key=None),
            client=client,
        )

    assert str(exc_info.value) == message
    assert exc_info.value.__cause__ is None
    assert "secret" not in str(exc_info.value)


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
