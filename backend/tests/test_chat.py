from pathlib import Path

from mapping_memory.chat import append_chat_turn, clear_chat, list_chat_messages
from mapping_memory.db import init_db
from mapping_memory.schemas import AskEvidenceSummary, AskResponse


def _response() -> AskResponse:
    return AskResponse(
        answer="Use the saved checklist. [1]",
        status="answered",
        evidence_summary=AskEvidenceSummary(
            source_count=1, snippet_count=1, match_types=["semantic"]
        ),
        sources=[],
        memory_updates=1,
    )


def test_chat_transcript_persists_successful_turns_by_user_and_clears_independently(
    tmp_path: Path,
) -> None:
    sqlite_path = tmp_path / "chat.sqlite"
    init_db(sqlite_path)

    append_chat_turn(sqlite_path, "owner-a", "What did I save?", _response())
    append_chat_turn(sqlite_path, "owner-b", "Other question", _response())

    messages = list_chat_messages(sqlite_path, "owner-a")
    assert [message.role for message in messages] == ["user", "assistant"]
    assert messages[1].status == "answered"
    assert messages[1].evidence_summary is not None
    assert messages[1].created_at

    clear_chat(sqlite_path, "owner-a")
    assert list_chat_messages(sqlite_path, "owner-a") == []
    assert len(list_chat_messages(sqlite_path, "owner-b")) == 2
