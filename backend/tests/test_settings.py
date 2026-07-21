import warnings

import pytest
from pydantic import SecretStr, ValidationError

from mapping_memory.settings import SUPPORTED_CHAT_TOOL_MODELS, Settings


def test_role_defaults_and_default_chat_model_support() -> None:
    settings = Settings(groq_api_key=None, _env_file=None)  # type: ignore[call-arg]

    assert settings.groq_chat_model == "openai/gpt-oss-120b"
    assert settings.groq_chat_reasoning_effort == "high"
    assert settings.groq_utility_model == "openai/gpt-oss-20b"
    assert settings.groq_utility_reasoning_effort == "medium"
    assert settings.groq_validation_model == "openai/gpt-oss-20b"
    assert settings.groq_validation_reasoning_effort == "medium"
    assert settings.groq_web_model == "openai/gpt-oss-120b"
    assert settings.groq_web_reasoning_effort == "high"
    assert settings.groq_chat_model in SUPPORTED_CHAT_TOOL_MODELS


@pytest.mark.parametrize("model", sorted(SUPPORTED_CHAT_TOOL_MODELS))
def test_supported_explicit_chat_models_are_accepted(model: str) -> None:
    assert Settings(groq_api_key=None, groq_chat_model=model).groq_chat_model == model


@pytest.mark.parametrize("field", ["groq_chat_model", "groq_model"])
def test_unsupported_chat_model_is_rejected_without_exposing_api_key(field: str) -> None:
    secret = "groq-secret-must-not-appear"

    with pytest.raises(ValidationError) as exc_info:
        Settings.model_validate({"groq_api_key": SecretStr(secret), field: "unsupported-model"})

    message = str(exc_info.value)
    assert (
        "GROQ_CHAT_MODEL must be one of the supported local/remote tool-calling models:" in message
    )
    assert secret not in message


def test_explicit_role_values_override_legacy_fallback() -> None:
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        settings = Settings(
            groq_api_key=None,
            groq_model="openai/gpt-oss-120b",
            groq_reasoning_effort="low",
            groq_chat_model="llama-3.3-70b-versatile",
            groq_chat_reasoning_effort="high",
            groq_utility_model="qwen/qwen3-32b",
            groq_utility_reasoning_effort="medium",
        )

    assert settings.groq_chat_model == "llama-3.3-70b-versatile"
    assert settings.groq_chat_reasoning_effort == "high"
    assert settings.groq_utility_model == "qwen/qwen3-32b"
    assert settings.groq_utility_reasoning_effort == "medium"
    assert settings.groq_validation_model == "openai/gpt-oss-120b"
    assert settings.groq_validation_reasoning_effort == "low"
    assert settings.groq_web_model == "openai/gpt-oss-120b"
    assert settings.groq_web_reasoning_effort == "low"
    assert len(captured) == 1
    assert "GROQ_MODEL and GROQ_REASONING_EFFORT are deprecated" in str(captured[0].message)
