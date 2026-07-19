from pathlib import Path
from typing import Literal

from pydantic import SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "Note Memory"
    environment: str = "local"
    sqlite_path: Path = Path("../data/mapping_memory.sqlite")
    chroma_path: Path = Path("../data/chroma")
    memory_enabled: bool = True
    memory_path: Path = Path("../data/memory")
    vault_path: Path = Path("../data/vault")
    groq_api_key: SecretStr | None = None
    groq_model: str = "openai/gpt-oss-120b"
    groq_reasoning_effort: Literal["low", "medium", "high"] = "medium"
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

    @model_validator(mode="after")
    def resolve_default_vault_next_to_sqlite(self) -> "Settings":
        default_vault_path = (BACKEND_DIR / "../data/vault").resolve()
        if self.vault_path == default_vault_path:
            self.vault_path = self.sqlite_path.parent / "vault"
        return self

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
