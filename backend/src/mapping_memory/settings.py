from pathlib import Path

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    app_name: str = "Mapping Memory"
    environment: str = "local"
    sqlite_path: Path = Path("../data/mapping_memory.sqlite")
    chroma_path: Path = Path("../data/chroma")
    openai_api_key: SecretStr | None = None
    openai_organizer_model: str = "gpt-5.4-mini"
    openai_embedding_model: str = "text-embedding-3-small"

    @field_validator("sqlite_path", "chroma_path", mode="after")
    @classmethod
    def resolve_backend_relative_path(cls, value: Path) -> Path:
        if value.is_absolute():
            return value

        return (BACKEND_DIR / value).resolve()

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")
