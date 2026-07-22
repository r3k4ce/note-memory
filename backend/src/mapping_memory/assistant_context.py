"""Canonical, provider-free context loading for a persisted generation job."""

import json
import logging
from collections.abc import Mapping, Sequence
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from types import MappingProxyType
from typing import Any, Literal, Protocol

from mapping_memory.db import connect_db
from mapping_memory.memory import LOCAL_OWNER_ID

logger = logging.getLogger(__name__)

RUNTIME_MAX_CHARS = 256
CURRENT_MESSAGE_MAX_CHARS = 4_000
SUMMARY_MAX_CHARS = 4_000
RECENT_MESSAGE_LIMIT = 10
RECENT_MESSAGE_MAX_CHARS = 1_200
MEMORY_LIMIT = 5
MEMORY_MAX_CHARS = 800
SCOPE_NOTE_ID_LIMIT = 500
TOOL_LIMIT = 16
TOOLS_MAX_SERIALIZED_BYTES = 12 * 1024

MessageRole = Literal["user", "assistant"]
ScopeMode = Literal["all", "custom"]


class MemoryClient(Protocol):
    def search(self, query: str) -> Sequence[Any]: ...


@dataclass(frozen=True)
class RuntimeMetadata:
    generation_job_id: int
    thread_id: int
    timezone: str
    loaded_at: str


@dataclass(frozen=True)
class SavedTurnScope:
    mode: ScopeMode
    note_ids: tuple[int, ...] = ()


@dataclass(frozen=True)
class BackgroundSummary:
    content: str | None
    is_evidence: Literal[False] = False


@dataclass(frozen=True)
class BackgroundMemory:
    id: str
    content: str
    is_evidence: Literal[False] = False


@dataclass(frozen=True)
class ContextMessage:
    id: int
    role: MessageRole
    content: str


@dataclass(frozen=True)
class AssistantContext:
    """Immutable sections ordered for model construction, with parallel tool definitions."""

    runtime: RuntimeMetadata
    scope: SavedTurnScope
    summary: BackgroundSummary
    memories: tuple[BackgroundMemory, ...]
    recent_messages: tuple[ContextMessage, ...]
    current_message: ContextMessage
    tools: tuple[Mapping[str, Any], ...]


def load_assistant_context(
    sqlite_path: Path,
    generation_job_id: int,
    *,
    tools: Sequence[Mapping[str, Any]],
    memory_client: MemoryClient | None = None,
    user_id: str = LOCAL_OWNER_ID,
) -> AssistantContext | None:
    """Load only the local owner's saved state for one generation job.

    This deliberately performs neither provider calls nor writes. Memory lookup is the sole
    best-effort dependency and any failure returns an empty memory section.
    """

    with closing(connect_db(sqlite_path)) as connection:
        job = connection.execute(
            """SELECT jobs.id, jobs.thread_id, jobs.user_message_id, messages.content
               FROM generation_jobs AS jobs
               JOIN chat_messages AS messages ON messages.id = jobs.user_message_id
               JOIN chat_threads AS threads ON threads.id = jobs.thread_id
               WHERE jobs.id = ? AND jobs.user_id = ? AND messages.user_id = ?
                 AND messages.thread_id = jobs.thread_id AND messages.role = 'user'
                 AND threads.user_id = ?""",
            (generation_job_id, user_id, user_id, user_id),
        ).fetchone()
        if job is None:
            return None

        scope = _load_scope(connection, job["user_message_id"])
        summary, lower_bound = _load_summary(
            connection, user_id, job["thread_id"], job["user_message_id"]
        )
        recent_messages = _load_recent_messages(
            connection,
            user_id=user_id,
            thread_id=job["thread_id"],
            lower_bound=lower_bound,
            current_message_id=job["user_message_id"],
        )

    current_content = _clip_stored_text(job["content"], CURRENT_MESSAGE_MAX_CHARS)
    memories = _load_memories(memory_client, job["content"])
    now = datetime.now().astimezone()
    timezone = str(now.tzinfo or "local")
    runtime = RuntimeMetadata(
        generation_job_id=job["id"],
        thread_id=job["thread_id"],
        timezone=_clip_stored_text(timezone, RUNTIME_MAX_CHARS),
        loaded_at=now.isoformat(),
    )
    return AssistantContext(
        runtime=runtime,
        scope=scope,
        summary=BackgroundSummary(summary),
        memories=memories,
        recent_messages=recent_messages,
        current_message=ContextMessage(
            id=job["user_message_id"], role="user", content=current_content
        ),
        tools=_bounded_tools(tools),
    )


def _load_scope(connection: Any, user_message_id: int) -> SavedTurnScope:
    row = connection.execute(
        "SELECT mode FROM chat_turn_scopes WHERE user_message_id = ?", (user_message_id,)
    ).fetchone()
    if row is None or row["mode"] == "all":
        return SavedTurnScope(mode="all")
    ids = connection.execute(
        """SELECT note_id FROM chat_turn_scope_note_ids
           WHERE user_message_id = ? ORDER BY position LIMIT ?""",
        (user_message_id, SCOPE_NOTE_ID_LIMIT),
    ).fetchall()
    return SavedTurnScope(mode="custom", note_ids=tuple(row["note_id"] for row in ids))


def _load_summary(
    connection: Any, user_id: str, thread_id: int, current_message_id: int
) -> tuple[str | None, int]:
    row = connection.execute(
        """SELECT summaries.summary, summaries.last_summarized_message_id
           FROM chat_thread_summaries AS summaries
           JOIN chat_threads AS threads ON threads.id = summaries.thread_id
           WHERE summaries.thread_id = ? AND threads.user_id = ?
             AND summaries.last_summarized_message_id < ?""",
        (thread_id, user_id, current_message_id),
    ).fetchone()
    if row is None:
        return None, 0
    summary = row["summary"].strip()
    return (_clip_stored_text(summary, SUMMARY_MAX_CHARS) if summary else None), row[
        "last_summarized_message_id"
    ]


def _load_recent_messages(
    connection: Any,
    *,
    user_id: str,
    thread_id: int,
    lower_bound: int,
    current_message_id: int,
) -> tuple[ContextMessage, ...]:
    rows = connection.execute(
        """SELECT id, role, content FROM chat_messages
           WHERE user_id = ? AND thread_id = ? AND id > ? AND id < ?
             AND length(trim(content)) > 0
             AND (role = 'user' OR (role = 'assistant' AND status = 'completed'))
           ORDER BY id DESC LIMIT ?""",
        (user_id, thread_id, lower_bound, current_message_id, RECENT_MESSAGE_LIMIT),
    ).fetchall()
    return tuple(
        ContextMessage(
            id=row["id"],
            role=row["role"],
            content=_clip_stored_text(row["content"], RECENT_MESSAGE_MAX_CHARS),
        )
        for row in reversed(rows)
    )


def _load_memories(
    memory_client: MemoryClient | None, current_message: str
) -> tuple[BackgroundMemory, ...]:
    if memory_client is None:
        return ()
    try:
        records = memory_client.search(current_message)
        memories: list[BackgroundMemory] = []
        for record in records:
            content = str(record.content).strip()
            if not content:
                continue
            memories.append(
                BackgroundMemory(
                    id=str(record.id), content=_clip_stored_text(content, MEMORY_MAX_CHARS)
                )
            )
            if len(memories) == MEMORY_LIMIT:
                break
        return tuple(memories)
    except Exception:
        logger.warning("Assistant-context memory search unavailable")
        return ()


def _bounded_tools(tools: Sequence[Mapping[str, Any]]) -> tuple[Mapping[str, Any], ...]:
    accepted: list[Mapping[str, Any]] = []
    for tool in tools:
        if len(accepted) == TOOL_LIMIT:
            break
        try:
            serialized = json.dumps([*accepted, tool], separators=(",", ":"), ensure_ascii=False)
        except (TypeError, ValueError):
            continue
        if len(serialized.encode()) > TOOLS_MAX_SERIALIZED_BYTES:
            continue
        accepted.append(tool)
    return tuple(_freeze_mapping(tool) for tool in accepted)


def _freeze_mapping(value: Mapping[str, Any]) -> Mapping[str, Any]:
    return MappingProxyType({key: _freeze_value(item) for key, item in value.items()})


def _freeze_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        return _freeze_mapping(value)
    if isinstance(value, list):
        return tuple(_freeze_value(item) for item in value)
    if isinstance(value, tuple):
        return tuple(_freeze_value(item) for item in value)
    return value


def _clip_stored_text(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    return f"{value[: limit - 1]}…"
