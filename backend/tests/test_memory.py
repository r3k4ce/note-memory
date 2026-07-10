import os
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from mapping_memory.main import create_app
from mapping_memory.memory import LOCAL_OWNER_ID, MemoryAdapter
from mapping_memory.settings import Settings


class FakeMem0:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.records = [
            {
                "id": "memory-1",
                "memory": "Prefers concise answers.",
                "created_at": "2026-07-01T00:00:00Z",
                "updated_at": None,
                "user_id": LOCAL_OWNER_ID,
            }
        ]

    def search(self, query: str, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("search", (query, kwargs)))
        return {"results": self.records}

    def add(self, messages: list[dict[str, str]], **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("add", (messages, kwargs)))
        return {"results": [{"id": "memory-2", "memory": "Uses TypeScript.", "event": "ADD"}]}

    def get_all(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(("get_all", kwargs))
        return {"results": self.records}

    def update(self, memory_id: str, *, data: str) -> dict[str, str]:
        self.calls.append(("update", (memory_id, data)))
        self.records[0]["memory"] = data
        return {"message": "ok"}

    def delete(self, memory_id: str) -> dict[str, str]:
        self.calls.append(("delete", memory_id))
        self.records = [record for record in self.records if record["id"] != memory_id]
        return {"message": "ok"}

    def delete_all(self, *, user_id: str) -> dict[str, str]:
        self.calls.append(("delete_all", user_id))
        self.records = []
        return {"message": "ok"}


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        sqlite_path=tmp_path / "app.sqlite",
        memory_path=tmp_path / "memory",
        openai_api_key=SecretStr("test-key"),
    )


def test_memory_adapter_scopes_search_learning_and_crud_to_local_owner(tmp_path: Path) -> None:
    client = FakeMem0()
    adapter = MemoryAdapter(_settings(tmp_path), client=client)

    assert [record.content for record in adapter.search("How should I answer?")] == [
        "Prefers concise answers."
    ]
    assert adapter.learn("I use TypeScript.", "A grounded answer.") == 1
    assert adapter.list()[0].id == "memory-1"
    assert adapter.update("memory-1", "Prefers short, direct answers.").content == (
        "Prefers short, direct answers."
    )
    adapter.delete("memory-1")
    adapter.delete_all()

    search_call = client.calls[0][1]
    assert search_call[1] == {"top_k": 5, "filters": {"user_id": LOCAL_OWNER_ID}}
    add_call = client.calls[1][1]
    assert add_call[1]["user_id"] == LOCAL_OWNER_ID
    assert add_call[0] == [{"role": "user", "content": "I use TypeScript."}]
    assert client.calls[-1] == ("delete_all", LOCAL_OWNER_ID)


def test_memory_adapter_builds_dedicated_persistent_mem0_config(
    tmp_path: Path, monkeypatch
) -> None:
    captured: dict[str, Any] = {}

    class FakeMemory:
        @classmethod
        def from_config(cls, config: dict[str, Any]) -> FakeMem0:
            captured.update(config)
            return FakeMem0()

    monkeypatch.setattr("mapping_memory.memory.Memory", FakeMemory)
    settings = _settings(tmp_path)

    MemoryAdapter(settings).list()

    assert captured["vector_store"]["provider"] == "chroma"
    assert captured["vector_store"]["config"] == {
        "collection_name": "user_memories",
        "path": str(settings.memory_path / "chroma"),
    }
    assert captured["history_db_path"] == str(settings.memory_path / "history.sqlite")
    assert captured["llm"]["config"]["model"] == settings.openai_organizer_model
    assert captured["embedder"]["config"]["model"] == settings.openai_embedding_model
    instructions = captured["custom_instructions"].lower()
    assert "assistant-originated" in instructions
    assert "credentials" in instructions
    assert "health" in instructions
    assert "financial" in instructions
    assert "legal" in instructions


def test_memory_api_crud_settings_validation_and_independent_chat_clear(
    tmp_path: Path, monkeypatch
) -> None:
    fake = FakeMem0()
    monkeypatch.setattr(
        "mapping_memory.main.MemoryAdapter", lambda settings: MemoryAdapter(settings, client=fake)
    )
    monkeypatch.setattr("mapping_memory.main._reconcile_chroma_with_sqlite", lambda **_: None)
    app = create_app(_settings(tmp_path))

    with TestClient(app) as client:
        assert client.get("/memory-settings").json() == {
            "available": True,
            "learning_enabled": True,
        }
        assert client.patch("/memory-settings", json={"learning_enabled": False}).json() == {
            "available": True,
            "learning_enabled": False,
        }
        assert client.get("/memories").json()[0]["content"] == "Prefers concise answers."
        assert client.patch("/memories/memory-1", json={"content": " "}).status_code == 422
        updated = client.patch("/memories/memory-1", json={"content": "Prefers direct answers."})
        assert updated.status_code == 200
        assert updated.json()["content"] == "Prefers direct answers."
        assert client.delete("/chat").status_code == 204
        assert client.get("/memories").json() != []
        assert client.delete("/memories/memory-1").status_code == 204
        assert client.delete("/memories").status_code == 204


@pytest.mark.parametrize(("memory_enabled", "has_key"), [(False, True), (True, False)])
def test_memory_settings_report_unavailable_without_feature_and_key(
    tmp_path: Path, monkeypatch, memory_enabled: bool, has_key: bool
) -> None:
    monkeypatch.setattr("mapping_memory.main._reconcile_chroma_with_sqlite", lambda **_: None)
    settings = Settings(
        sqlite_path=tmp_path / "app.sqlite",
        memory_path=tmp_path / "memory",
        memory_enabled=memory_enabled,
        openai_api_key=SecretStr("test-key") if has_key else None,
    )
    with TestClient(create_app(settings)) as client:
        response = client.get("/memory-settings")

    assert response.json()["available"] is False


def test_mem0_live_crud_filtering_and_persistence_compatibility(tmp_path: Path) -> None:
    if os.getenv("RUN_MEM0_INTEGRATION_TESTS") != "1":
        pytest.skip("Set RUN_MEM0_INTEGRATION_TESTS=1 to run live Mem0/OpenAI tests")
    settings = Settings(memory_path=tmp_path / "memory")
    if settings.openai_api_key is None:
        pytest.skip("OPENAI_API_KEY is not configured")

    adapter = MemoryAdapter(settings)
    client = adapter._memory()
    added = client.add(
        [{"role": "user", "content": "I prefer compact Markdown answers."}],
        user_id=LOCAL_OWNER_ID,
        infer=False,
    )
    memory_id = added["results"][0]["id"]
    try:
        assert adapter.search("answer formatting")[0].id == memory_id
        adapter.update(memory_id, "Prefers short Markdown answers.")

        reloaded = MemoryAdapter(settings)
        assert next(record for record in reloaded.list() if record.id == memory_id).content == (
            "Prefers short Markdown answers."
        )
        reloaded.delete(memory_id)
        assert all(record.id != memory_id for record in reloaded.list())
    finally:
        adapter.delete_all()


@pytest.fixture
def live_memory_policy_messages() -> dict[str, tuple[str, str]]:
    return {
        "stable_preference": ("I prefer concise Markdown answers.", "Understood."),
        "correction": (
            "Correction: I prefer concise plain-text answers.",
            "Thanks for correcting me.",
        ),
        "transient": ("I feel tired today and might take a walk later.", "Take care."),
        "assistant_claim": ("Okay.", "You always use Kubernetes and dislike Python."),
        "sensitive": (
            "My API key is sk-example, I live at 123 Example Street, and my diagnosis is private.",
            "I won't retain that.",
        ),
    }


def test_mem0_live_extraction_policy(
    tmp_path: Path, live_memory_policy_messages: dict[str, tuple[str, str]]
) -> None:
    if os.getenv("RUN_MEM0_POLICY_TESTS") != "1":
        pytest.skip("Set RUN_MEM0_POLICY_TESTS=1 to run live memory extraction policy tests")
    settings = Settings(memory_path=tmp_path / "policy-memory")
    if settings.openai_api_key is None:
        pytest.skip("OPENAI_API_KEY is not configured")

    adapter = MemoryAdapter(settings)
    try:
        for user_message, assistant_message in live_memory_policy_messages.values():
            adapter.learn(user_message, assistant_message)

        contents = "\n".join(record.content.lower() for record in adapter.list())
        assert "plain-text" in contents or "plain text" in contents
        assert "markdown" not in contents
        assert "tired" not in contents
        assert "walk" not in contents
        assert "kubernetes" not in contents
        assert "python" not in contents
        assert "sk-example" not in contents
        assert "123 example street" not in contents
        assert "diagnosis" not in contents
    finally:
        adapter.delete_all()
