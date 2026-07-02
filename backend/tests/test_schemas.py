import pytest
from pydantic import ValidationError

from mapping_memory.schemas import AskRequest, NoteUpdate


def test_ask_request_accepts_note_ids() -> None:
    ask_request = AskRequest.model_validate({"question": "What changed?", "note_ids": [1, 2, 3]})

    assert ask_request.note_ids == [1, 2, 3]


def test_ask_request_accepts_empty_note_ids() -> None:
    ask_request = AskRequest.model_validate({"question": "What changed?", "note_ids": []})

    assert ask_request.note_ids == []


def test_ask_request_deduplicates_note_ids_in_order() -> None:
    ask_request = AskRequest.model_validate(
        {"question": "What changed?", "note_ids": [3, 1, 3, 2, 1]}
    )

    assert ask_request.note_ids == [3, 1, 2]


@pytest.mark.parametrize("note_id", [0, -1, "1", 1.2, True])
def test_ask_request_rejects_invalid_note_ids(note_id: object) -> None:
    with pytest.raises(ValidationError):
        AskRequest.model_validate({"question": "What changed?", "note_ids": [note_id]})


def test_ask_request_rejects_more_than_500_note_ids() -> None:
    with pytest.raises(ValidationError, match="note_ids must contain at most 500 values"):
        AskRequest.model_validate({"question": "What changed?", "note_ids": list(range(1, 502))})


def test_ask_request_without_note_ids_remains_valid() -> None:
    ask_request = AskRequest.model_validate({"question": "What changed?"})

    assert ask_request.note_ids is None


def test_note_update_accepts_original_text_and_preserves_it_exactly() -> None:
    original_text = "  Leading spaces\n\n\tTabbed line  \nTrailing newline\n"

    note_update = NoteUpdate.model_validate({"original_text": original_text})

    assert note_update.model_dump(exclude_unset=True)["original_text"] == original_text


@pytest.mark.parametrize("original_text", [" \n\t ", ""])
def test_note_update_rejects_blank_original_text(original_text: str) -> None:
    with pytest.raises(ValidationError, match="original_text must not be empty"):
        NoteUpdate.model_validate({"original_text": original_text})


@pytest.mark.parametrize("original_text", [123, None])
def test_note_update_rejects_non_string_original_text(original_text: object) -> None:
    with pytest.raises(ValidationError, match="original_text must be a string"):
        NoteUpdate.model_validate({"original_text": original_text})


def test_note_update_keeps_existing_metadata_validation() -> None:
    note_update = NoteUpdate.model_validate(
        {
            "ai_title": " Corrected title ",
            "short_summary": " Corrected summary. ",
            "tags": [" Routing ", "routing", "Memory"],
            "category_id": 1,
        }
    )

    assert note_update.model_dump(exclude_unset=True) == {
        "ai_title": "Corrected title",
        "short_summary": "Corrected summary.",
        "tags": ["routing", "memory"],
        "category_id": 1,
    }
