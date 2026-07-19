from __future__ import annotations

import logging
import os
import shutil
import sys
from pathlib import Path
from types import ModuleType
from typing import Any, Literal, cast

# Mem0 reads this at import time. The application is local-first and does not
# send usage telemetry to third parties.
os.environ["MEM0_TELEMETRY"] = "False"

from mem0 import Memory

from mapping_memory.groq_ai import create_groq_client
from mapping_memory.provider_fingerprint import (
    expected_memory_fingerprint,
    memory_fingerprint_compatible,
    memory_fingerprint_path,
    write_provider_fingerprint,
)
from mapping_memory.schemas import MemoryRecord
from mapping_memory.settings import Settings
from mapping_memory.voyage_embeddings import create_voyage_client

LOCAL_OWNER_ID = "local-owner"
MEMORY_COLLECTION = "user_memories"
MEMORY_TOP_K = 5
MEMORY_INSTRUCTIONS = """Extract only durable facts explicitly stated by the user.
Keep preferred identity or name information; communication and formatting preferences;
work context, expertise, and recurring tools; and durable interests, goals, routines,
corrections, and dislikes.
Never retain assistant-originated claims, guesses, inferred traits, temporary moods,
one-off plans, credentials, secrets, exact addresses, or health, financial, or legal details.
When the user corrects a durable fact, update or replace the old memory.
If nothing qualifies, return no facts."""

logger = logging.getLogger(__name__)


class MemoryNotFoundError(LookupError):
    pass


class MemoryAdapter:
    def __init__(self, settings: Settings, *, client: Any | None = None) -> None:
        self.settings = settings
        self._client = client
        self._ready = client is not None and self._configured

    @property
    def _configured(self) -> bool:
        return (
            self.settings.memory_enabled
            and self.settings.groq_api_key is not None
            and self.settings.voyage_api_key is not None
        )

    @property
    def available(self) -> bool:
        return self._configured and self._ready

    def initialize(self) -> bool:
        self._ready = False
        if not self._configured:
            return False

        try:
            compatible = memory_fingerprint_compatible(self.settings)
            if not compatible:
                self._reset_incompatible_store()
            self._memory()
            if not compatible:
                write_provider_fingerprint(
                    memory_fingerprint_path(self.settings),
                    expected_memory_fingerprint(self.settings),
                )
        except Exception:
            logger.warning("Learned memory initialization is unavailable")
            self._ready = False
            return False

        self._ready = True
        return True

    def search(self, query: str) -> list[MemoryRecord]:
        if not self.available:
            return []
        result = self._memory().search(
            query,
            top_k=MEMORY_TOP_K,
            filters={"user_id": LOCAL_OWNER_ID},
        )
        return self._records(result)

    def learn(self, user_message: str, assistant_message: str) -> int:
        if not self.available:
            return 0
        result = self._memory().add(
            [{"role": "user", "content": user_message}],
            user_id=LOCAL_OWNER_ID,
        )
        results = result.get("results", []) if isinstance(result, dict) else []
        if not isinstance(results, list):
            return 0
        return sum(
            1
            for item in results
            if isinstance(item, dict) and item.get("event") in {"ADD", "UPDATE"}
        )

    def list(self) -> list[MemoryRecord]:
        if not self.available:
            return []
        return self._records(
            self._memory().get_all(filters={"user_id": LOCAL_OWNER_ID}, top_k=1000)
        )

    def update(self, memory_id: str, content: str) -> MemoryRecord:
        record = self._owned(memory_id)
        self._memory().update(memory_id, data=content)
        return record.model_copy(update={"content": content})

    def delete(self, memory_id: str) -> None:
        self._owned(memory_id)
        self._memory().delete(memory_id)

    def delete_all(self) -> None:
        if self.available:
            self._memory().delete_all(user_id=LOCAL_OWNER_ID)

    def _owned(self, memory_id: str) -> MemoryRecord:
        record = next((item for item in self.list() if item.id == memory_id), None)
        if record is None:
            raise MemoryNotFoundError(memory_id)
        return record

    def _memory(self) -> Any:
        if self._client is None:
            if not self._configured:
                raise RuntimeError("Memory is unavailable")
            self.settings.memory_path.mkdir(parents=True, exist_ok=True)
            groq_api_key = self.settings.groq_api_key
            voyage_api_key = self.settings.voyage_api_key
            if groq_api_key is None or voyage_api_key is None:
                raise RuntimeError("Memory is unavailable")
            memory = Memory.from_config(
                {
                    "vector_store": {
                        "provider": "chroma",
                        "config": {
                            "collection_name": MEMORY_COLLECTION,
                            "path": str(self.settings.memory_path / "chroma"),
                        },
                    },
                    "llm": {
                        "provider": "groq",
                        "config": {
                            "api_key": groq_api_key.get_secret_value(),
                            "model": self.settings.groq_model,
                            "reasoning_effort": self.settings.groq_reasoning_effort,
                        },
                    },
                    "embedder": {
                        "provider": "langchain",
                        "config": {"model": _create_voyage_embeddings(self.settings)},
                    },
                    "history_db_path": str(self.settings.memory_path / "history.sqlite"),
                    "custom_instructions": MEMORY_INSTRUCTIONS,
                    "version": "v1.1",
                }
            )
            _configure_mem0_groq_client(memory, self.settings)
            self._client = memory
        return self._client

    def _reset_incompatible_store(self) -> None:
        memory_path = self.settings.memory_path.resolve()
        protected_paths = (
            self.settings.sqlite_path.resolve(),
            self.settings.chroma_path.resolve(),
            self.settings.vault_path.resolve(),
        )
        if (
            memory_path == Path(memory_path.anchor)
            or len(memory_path.parts) < 3
            or any(
                memory_path == path or memory_path in path.parents or path in memory_path.parents
                for path in protected_paths
            )
        ):
            raise RuntimeError("Refusing to reset an unsafe memory path")
        if memory_path.exists():
            if not memory_path.is_dir():
                raise RuntimeError("The configured memory path is not a directory")
            shutil.rmtree(memory_path)
        memory_path.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _records(result: object) -> list[MemoryRecord]:
        raw_records = result.get("results", []) if isinstance(result, dict) else []
        if not isinstance(raw_records, list):
            return []
        records: list[MemoryRecord] = []
        for item in raw_records:
            if not isinstance(item, dict) or not item.get("id") or not item.get("memory"):
                continue
            records.append(
                MemoryRecord(
                    id=str(item["id"]),
                    content=str(item["memory"]),
                    created_at=item.get("created_at"),
                    updated_at=item.get("updated_at"),
                )
            )
        return records


def _create_voyage_embeddings(settings: Settings) -> Any:
    _install_mem0_langchain_core_alias()
    from langchain_voyageai import VoyageAIEmbeddings
    from voyageai.client_async import AsyncClient

    api_key = settings.voyage_api_key
    if api_key is None:
        raise RuntimeError("Memory is unavailable")
    embeddings = VoyageAIEmbeddings(
        model=settings.voyage_embedding_model,
        api_key=api_key,
        output_dimension=cast(
            "Literal[256, 512, 1024, 2048]", settings.voyage_embedding_dimensions
        ),
        batch_size=64,
    )
    embeddings._client = create_voyage_client(settings)
    embeddings._aclient = AsyncClient(
        api_key=api_key.get_secret_value(),
        timeout=settings.voyage_timeout_seconds,
        max_retries=settings.voyage_max_retries,
    )
    return embeddings


class _ReasoningCompletions:
    def __init__(self, completions: Any, reasoning_effort: str) -> None:
        self._completions = completions
        self._reasoning_effort = reasoning_effort

    def create(self, **kwargs: Any) -> Any:
        kwargs.setdefault("reasoning_effort", self._reasoning_effort)
        return self._completions.create(**kwargs)


class _ReasoningGroqClient:
    def __init__(self, client: Any, reasoning_effort: str) -> None:
        self.chat = _ReasoningChat(client.chat, reasoning_effort)


class _ReasoningChat:
    def __init__(self, chat: Any, reasoning_effort: str) -> None:
        self.completions = _ReasoningCompletions(chat.completions, reasoning_effort)


def _configure_mem0_groq_client(
    memory: Any, settings: Settings, *, client: Any | None = None
) -> None:
    llm = getattr(memory, "llm", None)
    if llm is None:
        raise RuntimeError("Mem0 did not initialize its Groq provider")
    groq_client = client if client is not None else create_groq_client(settings)
    llm.client = _ReasoningGroqClient(groq_client, settings.groq_reasoning_effort)


def _install_mem0_langchain_core_alias() -> None:
    """Expose the minimal legacy import path required by Mem0's LangChain adapter."""
    from langchain_core.embeddings import Embeddings

    langchain = sys.modules.setdefault("langchain", ModuleType("langchain"))
    embeddings = sys.modules.setdefault("langchain.embeddings", ModuleType("langchain.embeddings"))
    base = sys.modules.setdefault(
        "langchain.embeddings.base", ModuleType("langchain.embeddings.base")
    )
    base.__dict__["Embeddings"] = Embeddings
    embeddings.__dict__["base"] = base
    langchain.__dict__["embeddings"] = embeddings
