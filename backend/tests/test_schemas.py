import pytest
from pydantic import ValidationError

from mapping_memory.schemas import NoteUpdate


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
