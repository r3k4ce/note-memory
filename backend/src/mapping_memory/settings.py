import warnings
from pathlib import Path
from typing import Any, Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]

SUPPORTED_CHAT_TOOL_MODELS = frozenset(
    {
        "openai/gpt-oss-20b",
        "openai/gpt-oss-120b",
        "openai/gpt-oss-safeguard-20b",
        "qwen/qwen3-32b",
        "qwen/qwen3.6-27b",
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
    }
)

DEFAULT_GROQ_CHAT_MODEL = "openai/gpt-oss-120b"
DEFAULT_GROQ_UTILITY_MODEL = "openai/gpt-oss-20b"
DEFAULT_GROQ_VALIDATION_MODEL = "openai/gpt-oss-20b"
DEFAULT_GROQ_WEB_MODEL = "openai/gpt-oss-120b"
ReasoningEffort = Literal["low", "medium", "high"]


class Settings(BaseSettings):
    app_name: str = "Note Memory"
    environment: str = "local"
    sqlite_path: Path = Path("../data/mapping_memory.sqlite")
    chroma_path: Path = Path("../data/chroma")
    memory_enabled: bool = True
    memory_path: Path = Path("../data/memory")
    vault_path: Path = Path("../data/vault")
    groq_api_key: SecretStr | None = None
    groq_model: str | None = None
    groq_reasoning_effort: ReasoningEffort | None = None
    groq_chat_model: str = DEFAULT_GROQ_CHAT_MODEL
    groq_chat_reasoning_effort: ReasoningEffort = "high"
    groq_utility_model: str = DEFAULT_GROQ_UTILITY_MODEL
    groq_utility_reasoning_effort: ReasoningEffort = "medium"
    groq_validation_model: str = DEFAULT_GROQ_VALIDATION_MODEL
    groq_validation_reasoning_effort: ReasoningEffort = "medium"
    groq_web_model: str = DEFAULT_GROQ_WEB_MODEL
    groq_web_reasoning_effort: ReasoningEffort = "high"
    groq_timeout_seconds: float = 60
    groq_max_retries: int = 1
    voyage_api_key: SecretStr | None = None
    voyage_embedding_model: str = "voyage-4-large"
    voyage_embedding_dimensions: int = 1024
    voyage_reranker_model: str = "rerank-2.5"
    voyage_timeout_seconds: float = 30
    voyage_max_retries: int = 1

    @field_validator("sqlite_path", "chroma_path", "memory_path", "vault_path", mode="after")
    @classmethod
    def resolve_backend_relative_path(cls, value: Path) -> Path:
        if value.is_absolute():
            return value

        return (BACKEND_DIR / value).resolve()

    @field_validator("groq_api_key", "voyage_api_key", mode="after")
    @classmethod
    def blank_provider_key_is_unconfigured(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None or not value.get_secret_value().strip():
            return None
        return value

    @model_validator(mode="before")
    @classmethod
    def apply_legacy_groq_fallback(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value

        legacy_model = value.get("groq_model")
        legacy_reasoning_effort = value.get("groq_reasoning_effort")
        if legacy_model is None and legacy_reasoning_effort is None:
            return value

        warnings.warn(
            "GROQ_MODEL and GROQ_REASONING_EFFORT are deprecated and will be removed "
            "in the next breaking configuration release. Use role-specific GROQ_* settings.",
            DeprecationWarning,
            stacklevel=2,
        )
        resolved = value.copy()
        for role in ("chat", "utility", "validation", "web"):
            if legacy_model is not None:
                resolved.setdefault(f"groq_{role}_model", legacy_model)
            if legacy_reasoning_effort is not None:
                resolved.setdefault(f"groq_{role}_reasoning_effort", legacy_reasoning_effort)
        return resolved

    @model_validator(mode="after")
    def resolve_defaults_and_validate_chat_model(self) -> "Settings":
        default_vault_path = (BACKEND_DIR / "../data/vault").resolve()
        if self.vault_path == default_vault_path:
            self.vault_path = self.sqlite_path.parent / "vault"

        self.validate_chat_model()
        return self

    def validate_chat_model(self) -> None:
        if self.groq_chat_model not in SUPPORTED_CHAT_TOOL_MODELS:
            supported_models = ", ".join(sorted(SUPPORTED_CHAT_TOOL_MODELS))
            raise ValueError(
                "GROQ_CHAT_MODEL must be one of the supported local/remote tool-calling "
                f"models: {supported_models}"
            )

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
