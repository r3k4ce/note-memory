import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
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
        groq_api_key=SecretStr("test-groq-key"),
        voyage_api_key=SecretStr("test-voyage-key"),
    )


def test_mem0_telemetry_is_disabled() -> None:
    assert os.environ["MEM0_TELEMETRY"] == "False"


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
    voyage_embeddings = object()
    monkeypatch.setattr(
        "mapping_memory.memory._create_voyage_embeddings",
        lambda settings: voyage_embeddings,
        raising=False,
    )
    configured_clients: list[object] = []
    monkeypatch.setattr(
        "mapping_memory.memory._configure_mem0_groq_client",
        lambda memory, settings: configured_clients.append(memory),
        raising=False,
    )
    settings = _settings(tmp_path)

    adapter = MemoryAdapter(settings)
    assert adapter.initialize() is True
    adapter.list()

    assert captured["vector_store"]["provider"] == "chroma"
    assert captured["vector_store"]["config"] == {
        "collection_name": "user_memories",
        "path": str(settings.memory_path / "chroma"),
    }
    assert captured["history_db_path"] == str(settings.memory_path / "history.sqlite")
    assert captured["llm"] == {
        "provider": "groq",
        "config": {
            "api_key": "test-groq-key",
            "model": settings.groq_model,
            "reasoning_effort": settings.groq_reasoning_effort,
        },
    }
    assert captured["embedder"] == {
        "provider": "langchain",
        "config": {"model": voyage_embeddings},
    }
    assert len(configured_clients) == 1
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
    monkeypatch.setattr(
        "mapping_memory.retrieval_index.reconcile_chroma_with_sqlite", lambda **_: None
    )
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


def test_chat_thread_api_crud_messages_and_validation(tmp_path: Path, monkeypatch) -> None:
    fake = FakeMem0()
    monkeypatch.setattr(
        "mapping_memory.main.MemoryAdapter", lambda settings: MemoryAdapter(settings, client=fake)
    )
    monkeypatch.setattr(
        "mapping_memory.retrieval_index.reconcile_chroma_with_sqlite", lambda **_: None
    )
    app = create_app(_settings(tmp_path))

    with TestClient(app) as client:
        initial_threads = client.get("/chat/threads")
        assert initial_threads.status_code == 200
        assert initial_threads.json()[0]["title"] == "Untitled chat"

        created = client.post(
            "/chat/threads",
            json={"title": " Launch questions ", "scope": {"mode": "custom", "note_ids": [10]}},
        )
        assert created.status_code == 201
        thread = created.json()
        assert thread["title"] == "Launch questions"
        assert thread["scope"] == {"mode": "custom", "note_ids": [10]}

        assert client.patch(f"/chat/threads/{thread['id']}", json={"title": " "}).status_code == 422
        patched = client.patch(
            f"/chat/threads/{thread['id']}",
            json={"title": "Renamed", "scope": {"mode": "all"}},
        )
        assert patched.status_code == 200
        assert patched.json()["title"] == "Renamed"
        assert patched.json()["scope"] == {"mode": "all"}
        assert client.get(f"/chat/threads/{thread['id']}/messages").json() == []
        assert client.delete(f"/chat/threads/{thread['id']}").status_code == 204
        assert client.get(f"/chat/threads/{thread['id']}/messages").status_code == 404


@pytest.mark.parametrize(
    ("memory_enabled", "groq_key", "voyage_key"),
    [(False, True, True), (True, False, False), (True, True, False), (True, False, True)],
)
def test_memory_settings_report_unavailable_without_feature_and_both_keys(
    tmp_path: Path,
    monkeypatch,
    memory_enabled: bool,
    groq_key: bool,
    voyage_key: bool,
) -> None:
    monkeypatch.setattr(
        "mapping_memory.retrieval_index.reconcile_chroma_with_sqlite", lambda **_: None
    )
    settings = Settings(
        sqlite_path=tmp_path / "app.sqlite",
        memory_path=tmp_path / "memory",
        memory_enabled=memory_enabled,
        groq_api_key=SecretStr("test-groq-key") if groq_key else None,
        voyage_api_key=SecretStr("test-voyage-key") if voyage_key else None,
    )
    with TestClient(create_app(settings)) as client:
        response = client.get("/memory-settings")

    assert response.json()["available"] is False


def test_incompatible_memory_is_preserved_when_either_key_is_missing(tmp_path: Path) -> None:
    settings = Settings(
        memory_path=tmp_path / "memory",
        groq_api_key=SecretStr("test-groq-key"),
        voyage_api_key=None,
    )
    settings.memory_path.mkdir(parents=True)
    marker = settings.memory_path / "legacy-memory.bin"
    marker.write_text("legacy")
    (settings.memory_path / "memory-provider.json").write_text('{"llm_provider":"openai"}')

    adapter = MemoryAdapter(settings)

    assert adapter.initialize() is False
    assert marker.read_text() == "legacy"
    assert adapter.available is False


def test_incompatible_memory_is_reset_with_both_keys_and_no_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = _settings(tmp_path)
    settings.memory_path.mkdir(parents=True)
    marker = settings.memory_path / "legacy-memory.bin"
    marker.write_text("legacy")
    (settings.memory_path / "memory-provider.json").write_text('{"llm_provider":"openai"}')
    fake = FakeMem0()

    class FakeMemory:
        @classmethod
        def from_config(cls, config: dict[str, Any]) -> FakeMem0:
            return fake

    monkeypatch.setattr("mapping_memory.memory.Memory", FakeMemory)
    monkeypatch.setattr(
        "mapping_memory.memory._create_voyage_embeddings", lambda settings: object(), raising=False
    )
    monkeypatch.setattr(
        "mapping_memory.memory._configure_mem0_groq_client",
        lambda memory, settings: None,
        raising=False,
    )

    adapter = MemoryAdapter(settings)

    assert adapter.initialize() is True
    assert not marker.exists()
    assert (settings.memory_path / "memory-provider.json").is_file()
    assert adapter.available is True
    assert list(tmp_path.glob("*backup*")) == []


def test_compatible_memory_fingerprint_preserves_store(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from mapping_memory.provider_fingerprint import (
        expected_memory_fingerprint,
        memory_fingerprint_path,
        write_provider_fingerprint,
    )

    settings = _settings(tmp_path)
    settings.memory_path.mkdir(parents=True)
    marker = settings.memory_path / "current-memory.bin"
    marker.write_text("current")
    write_provider_fingerprint(
        memory_fingerprint_path(settings), expected_memory_fingerprint(settings)
    )
    monkeypatch.setattr("mapping_memory.memory.MemoryAdapter._memory", lambda self: FakeMem0())

    adapter = MemoryAdapter(settings)

    assert adapter.initialize() is True
    assert marker.read_text() == "current"
    assert adapter.available is True


def test_memory_fingerprint_is_written_only_after_successful_initialization(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = _settings(tmp_path)

    class FailingMemory:
        @classmethod
        def from_config(cls, config: dict[str, Any]) -> None:
            raise RuntimeError("provider details")

    monkeypatch.setattr("mapping_memory.memory.Memory", FailingMemory)
    monkeypatch.setattr(
        "mapping_memory.memory._create_voyage_embeddings", lambda settings: object(), raising=False
    )

    adapter = MemoryAdapter(settings)

    assert adapter.initialize() is False
    assert not (settings.memory_path / "memory-provider.json").exists()
    assert adapter.available is False


def test_memory_reset_refuses_path_containing_canonical_note_data(tmp_path: Path) -> None:
    sqlite_path = tmp_path / "app.sqlite"
    sqlite_path.write_text("canonical notes")
    settings = Settings(
        sqlite_path=sqlite_path,
        chroma_path=tmp_path / "chroma",
        vault_path=tmp_path / "vault",
        memory_path=tmp_path,
        groq_api_key=SecretStr("test-groq-key"),
        voyage_api_key=SecretStr("test-voyage-key"),
    )

    adapter = MemoryAdapter(settings)

    assert adapter.initialize() is False
    assert sqlite_path.read_text() == "canonical notes"
    assert adapter.available is False


def test_mem0_groq_client_injects_reasoning_effort(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from mapping_memory.memory import _configure_mem0_groq_client

    calls: list[dict[str, Any]] = []

    class FakeCompletions:
        def create(self, **kwargs: Any) -> str:
            calls.append(kwargs)
            return "response"

    base_client = SimpleNamespace(chat=SimpleNamespace(completions=FakeCompletions()))
    memory = SimpleNamespace(llm=SimpleNamespace(client=None))
    settings = _settings(Path("/tmp/memory-client-test"))
    configured_settings: list[Settings] = []
    monkeypatch.setattr(
        "mapping_memory.memory.create_groq_client",
        lambda received: configured_settings.append(received) or base_client,
    )

    _configure_mem0_groq_client(memory, settings)
    response = memory.llm.client.chat.completions.create(model=settings.groq_model)

    assert response == "response"
    assert configured_settings == [settings]
    assert calls == [
        {"model": settings.groq_model, "reasoning_effort": settings.groq_reasoning_effort}
    ]


def test_mem0_voyage_bridge_uses_configured_sync_and_async_clients(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from mapping_memory.memory import _create_voyage_embeddings

    captured: dict[str, Any] = {}

    class FakeVoyageAIEmbeddings:
        def __init__(self, **kwargs: Any) -> None:
            captured["embeddings"] = kwargs
            self._client: object | None = None
            self._aclient: object | None = None

    class FakeAsyncClient:
        def __init__(self, **kwargs: Any) -> None:
            captured["async_client"] = kwargs

    fake_langchain_voyage = ModuleType("langchain_voyageai")
    fake_langchain_voyage.VoyageAIEmbeddings = FakeVoyageAIEmbeddings  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "langchain_voyageai", fake_langchain_voyage)
    monkeypatch.setattr("mapping_memory.memory._install_mem0_langchain_core_alias", lambda: None)
    sync_client = object()
    monkeypatch.setattr(
        "mapping_memory.memory.create_voyage_client", lambda settings: sync_client, raising=False
    )
    monkeypatch.setattr("voyageai.client_async.AsyncClient", FakeAsyncClient)
    settings = _settings(tmp_path).model_copy(
        update={"voyage_timeout_seconds": 23.0, "voyage_max_retries": 2}
    )

    embeddings = _create_voyage_embeddings(settings)

    assert embeddings._client is sync_client
    assert isinstance(embeddings._aclient, FakeAsyncClient)
    assert captured["embeddings"] == {
        "model": settings.voyage_embedding_model,
        "api_key": settings.voyage_api_key,
        "output_dimension": settings.voyage_embedding_dimensions,
        "batch_size": 64,
    }
    assert captured["async_client"] == {
        "api_key": "test-voyage-key",
        "timeout": 23.0,
        "max_retries": 2,
    }


@pytest.mark.live
def test_mem0_live_crud_filtering_and_persistence_compatibility(tmp_path: Path) -> None:
    if os.getenv("RUN_MEM0_INTEGRATION_TESTS") != "1":
        pytest.skip("Set RUN_MEM0_INTEGRATION_TESTS=1 to run live Mem0 provider tests")
    settings = Settings(memory_path=tmp_path / "memory")
    if settings.groq_api_key is None or settings.voyage_api_key is None:
        pytest.skip("GROQ_API_KEY and VOYAGE_API_KEY are not configured")

    adapter = MemoryAdapter(settings)
    assert adapter.initialize() is True
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
        assert reloaded.initialize() is True
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


@pytest.mark.live
def test_mem0_live_extraction_policy(
    tmp_path: Path, live_memory_policy_messages: dict[str, tuple[str, str]]
) -> None:
    if os.getenv("RUN_MEM0_POLICY_TESTS") != "1":
        pytest.skip("Set RUN_MEM0_POLICY_TESTS=1 to run live memory extraction policy tests")
    settings = Settings(memory_path=tmp_path / "policy-memory")
    if settings.groq_api_key is None or settings.voyage_api_key is None:
        pytest.skip("GROQ_API_KEY and VOYAGE_API_KEY are not configured")

    adapter = MemoryAdapter(settings)
    assert adapter.initialize() is True
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
