from __future__ import annotations

import json
import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel

from mapping_memory.settings import Settings

GroqRole = Literal["chat", "utility", "validation", "web"]


class GroqUnavailableError(RuntimeError):
    """Raised when Groq cannot be configured."""


class GroqProviderError(RuntimeError):
    """Raised when the Groq SDK request fails."""


class GroqRateLimitError(GroqProviderError):
    """Raised when Groq rejects a request for rate limiting."""


class GroqTimeoutError(GroqProviderError):
    """Raised when a Groq request times out."""


class GroqCancelledError(GroqProviderError):
    """Raised when a Groq request is cancelled before completion."""


class GroqResponseError(RuntimeError):
    """Raised when Groq returns unusable output."""


@dataclass(frozen=True)
class GroqChatRequest:
    role: GroqRole
    messages: Sequence[dict[str, Any]]
    tools: Sequence[dict[str, Any]] | None = None
    tool_choice: str | dict[str, Any] | None = None
    parallel_tool_calls: bool | None = None


@dataclass(frozen=True)
class GroqToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class GroqChatCompletion:
    content: str | None
    tool_calls: tuple[GroqToolCall, ...]
    finish_reason: str | None


class GroqAbort:
    def __init__(self) -> None:
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True

    def is_cancelled(self) -> bool:
        return self._cancelled


class GroqCompletionStream(Iterator[Any]):
    def __init__(self, stream: Iterator[Any], abort: GroqAbort | None = None) -> None:
        self._stream = stream
        self._abort = abort
        self._closed = False

    def __next__(self) -> Any:
        if self._abort is not None and self._abort.is_cancelled():
            self.close()
            raise StopIteration
        try:
            return next(self._stream)
        except StopIteration:
            self.close()
            raise

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        close = getattr(self._stream, "close", None)
        if callable(close):
            close()

    def cancel(self) -> None:
        if self._abort is not None:
            self._abort.cancel()
        self.close()


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


def request_chat_completion(
    request: GroqChatRequest,
    *,
    settings: Settings,
    client: Any | None = None,
    abort: GroqAbort | None = None,
) -> GroqChatCompletion:
    _raise_if_cancelled(abort)
    completion = _invoke_completion(
        request,
        settings=settings,
        client=client,
        extra_kwargs={},
    )
    _raise_if_cancelled(abort)
    return _parse_chat_completion(completion)


def stream_chat_completion(
    request: GroqChatRequest,
    *,
    settings: Settings,
    client: Any | None = None,
    abort: GroqAbort | None = None,
) -> GroqCompletionStream:
    _raise_if_cancelled(abort)
    stream = _invoke_completion(
        request,
        settings=settings,
        client=client,
        extra_kwargs={"stream": True},
    )
    _raise_if_cancelled(abort)
    return GroqCompletionStream(iter(stream), abort)


def request_structured_output[StructuredModel: BaseModel](
    messages: Sequence[dict[str, Any]],
    response_model: type[StructuredModel],
    *,
    role: GroqRole,
    settings: Settings,
    client: Any | None = None,
    abort: GroqAbort | None = None,
) -> StructuredModel:
    _raise_if_cancelled(abort)
    completion = _invoke_completion(
        GroqChatRequest(role=role, messages=messages),
        settings=settings,
        client=client,
        extra_kwargs={"response_format": _structured_response_format(response_model)},
    )
    _raise_if_cancelled(abort)
    try:
        content = _completion_message(completion).content
        if not isinstance(content, str) or not content.strip():
            raise ValueError("missing structured output")
        return response_model.model_validate_json(content)
    except (AttributeError, IndexError, TypeError, ValueError):
        raise GroqResponseError("Groq did not return valid structured output") from None


def _invoke_completion(
    request: GroqChatRequest,
    *,
    settings: Settings,
    client: Any | None,
    extra_kwargs: dict[str, Any],
) -> Any:
    groq_client = client or create_groq_client(settings)
    try:
        return groq_client.chat.completions.create(
            **_request_kwargs(request, settings=settings),
            **extra_kwargs,
        )
    except Exception as error:
        raise _provider_error(error) from None


def _request_kwargs(request: GroqChatRequest, *, settings: Settings) -> dict[str, Any]:
    model, reasoning_effort = _role_model_settings(request.role, settings)
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": request.messages,
        "reasoning_effort": reasoning_effort,
    }
    if request.tools is not None:
        kwargs["tools"] = request.tools
    if request.tool_choice is not None:
        kwargs["tool_choice"] = request.tool_choice
    if request.parallel_tool_calls is not None:
        kwargs["parallel_tool_calls"] = request.parallel_tool_calls
    return kwargs


def _role_model_settings(role: GroqRole, settings: Settings) -> tuple[str, str]:
    if role == "chat":
        return settings.groq_chat_model, settings.groq_chat_reasoning_effort
    if role == "utility":
        return settings.groq_utility_model, settings.groq_utility_reasoning_effort
    if role == "validation":
        return settings.groq_validation_model, settings.groq_validation_reasoning_effort
    return settings.groq_web_model, settings.groq_web_reasoning_effort


def _parse_chat_completion(completion: Any) -> GroqChatCompletion:
    try:
        choice = completion.choices[0]
        message = choice.message
        content = message.content
        if content is not None and (not isinstance(content, str) or not content.strip()):
            raise ValueError("blank content")
        tool_calls = _parse_tool_calls(message.tool_calls)
        if content is None and not tool_calls:
            raise ValueError("missing content and tool calls")
        finish_reason = choice.finish_reason
        if finish_reason is not None and not isinstance(finish_reason, str):
            raise TypeError("invalid finish reason")
        return GroqChatCompletion(
            content=content, tool_calls=tool_calls, finish_reason=finish_reason
        )
    except (AttributeError, IndexError, TypeError, ValueError, json.JSONDecodeError):
        raise GroqResponseError("Groq did not return a valid chat completion") from None


def _parse_tool_calls(tool_calls: Any) -> tuple[GroqToolCall, ...]:
    if tool_calls is None:
        return ()
    if not isinstance(tool_calls, (list, tuple)):
        raise TypeError("invalid tool calls")
    parsed: list[GroqToolCall] = []
    for tool_call in tool_calls:
        call_id = tool_call.id
        name = tool_call.function.name
        arguments = tool_call.function.arguments
        if not isinstance(call_id, str) or not call_id.strip():
            raise ValueError("invalid tool call id")
        if not isinstance(name, str) or not name.strip():
            raise ValueError("invalid tool call name")
        if not isinstance(arguments, str):
            raise TypeError("invalid tool call arguments")
        parsed_arguments = json.loads(arguments)
        if not isinstance(parsed_arguments, dict):
            raise TypeError("tool call arguments must be an object")
        parsed.append(
            GroqToolCall(id=call_id.strip(), name=name.strip(), arguments=parsed_arguments)
        )
    return tuple(parsed)


def _completion_message(completion: Any) -> Any:
    return completion.choices[0].message


def _structured_response_format(response_model: type[BaseModel]) -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": _schema_name(response_model.__name__),
            "strict": True,
            "schema": response_model.model_json_schema(),
        },
    }


def _provider_error(error: Exception) -> GroqProviderError:
    if error.__class__.__name__ == "RateLimitError":
        return GroqRateLimitError("Groq rate limit exceeded")
    if error.__class__.__name__ == "APITimeoutError":
        return GroqTimeoutError("Groq request timed out")
    return GroqProviderError("Groq request failed")


def _raise_if_cancelled(abort: GroqAbort | None) -> None:
    if abort is not None and abort.is_cancelled():
        raise GroqCancelledError("Groq request cancelled")


def _schema_name(model_name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", model_name).lower()
