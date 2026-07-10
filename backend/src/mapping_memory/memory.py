from __future__ import annotations

from typing import Any

from mem0 import Memory

from mapping_memory.schemas import MemoryRecord
from mapping_memory.settings import Settings

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


class MemoryNotFoundError(LookupError):
    pass


class MemoryAdapter:
    def __init__(self, settings: Settings, *, client: Any | None = None) -> None:
        self.settings = settings
        self._client = client

    @property
    def available(self) -> bool:
        return self.settings.memory_enabled and self.settings.openai_api_key is not None

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
            self.settings.memory_path.mkdir(parents=True, exist_ok=True)
            api_key = self.settings.openai_api_key
            if api_key is None:
                raise RuntimeError("Memory is unavailable")
            self._client = Memory.from_config(
                {
                    "vector_store": {
                        "provider": "chroma",
                        "config": {
                            "collection_name": MEMORY_COLLECTION,
                            "path": str(self.settings.memory_path / "chroma"),
                        },
                    },
                    "llm": {
                        "provider": "openai",
                        "config": {
                            "api_key": api_key.get_secret_value(),
                            "model": self.settings.openai_organizer_model,
                        },
                    },
                    "embedder": {
                        "provider": "openai",
                        "config": {
                            "api_key": api_key.get_secret_value(),
                            "model": self.settings.openai_embedding_model,
                        },
                    },
                    "history_db_path": str(self.settings.memory_path / "history.sqlite"),
                    "custom_instructions": MEMORY_INSTRUCTIONS,
                    "version": "v1.1",
                }
            )
        return self._client

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
