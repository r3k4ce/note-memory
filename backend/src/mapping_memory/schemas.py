from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class CategoryCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("name must not be blank")

        return stripped_value


class CategoryUpdate(BaseModel):
    name: str

    model_config = ConfigDict(extra="forbid")

    @field_validator("name")
    @classmethod
    def name_must_not_be_blank(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("name must not be blank")

        return stripped_value


class CategoryRead(BaseModel):
    id: int
    name: str
    slug: str
    created_at: str
    updated_at: str


class NoteCreate(BaseModel):
    original_text: str
    ai_title: str | None = None
    short_summary: str | None = None
    tags: list[str] | None = None
    category_id: int | None = None

    @field_validator("original_text")
    @classmethod
    def original_text_must_not_be_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("original_text must not be empty")

        return value

    @field_validator("ai_title", "short_summary", mode="before")
    @classmethod
    def optional_text_field_must_not_be_blank(cls, value: Any) -> str | None:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError("field must be a string")
        stripped_value = value.strip()
        if not stripped_value:
            return None
        return stripped_value

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: Any) -> list[str] | None:
        if value is None:
            return None
        return NoteUpdate.normalize_tags(value)

    @field_validator("category_id")
    @classmethod
    def category_id_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("category_id must be positive")

        return value


class NoteUpdate(BaseModel):
    original_text: str | None = None
    ai_title: str | None = None
    short_summary: str | None = None
    tags: list[str] | None = None
    category_id: int | None = None

    model_config = ConfigDict(extra="forbid")

    @field_validator("original_text", mode="before")
    @classmethod
    def original_text_must_not_be_empty(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("original_text must be a string")

        if not value.strip():
            raise ValueError("original_text must not be empty")

        return value

    @field_validator("ai_title", "short_summary", mode="before")
    @classmethod
    def text_must_not_be_blank(cls, value: Any) -> str:
        if not isinstance(value, str):
            raise ValueError("value must be a string")

        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("value must not be blank")

        return stripped_value

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            raise ValueError("tags must be a list")

        normalized_tags: list[str] = []
        seen_tags: set[str] = set()
        for tag in value:
            if not isinstance(tag, str):
                raise ValueError("tags must be strings")

            normalized_tag = tag.strip().lower()
            if not normalized_tag:
                raise ValueError("tags must not be blank")
            if normalized_tag in seen_tags:
                continue

            normalized_tags.append(normalized_tag)
            seen_tags.add(normalized_tag)

        if len(normalized_tags) > 10:
            raise ValueError("tags must contain at most 10 values")

        return normalized_tags

    @field_validator("category_id")
    @classmethod
    def category_id_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("category_id must be positive")

        return value

    @model_validator(mode="after")
    def at_least_one_field(self) -> "NoteUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one update field must be provided")

        return self


class NoteRead(BaseModel):
    id: int
    original_text: str
    ai_title: str
    short_summary: str
    tags: list[str]
    date_added: str
    updated_at: str
    category: CategoryRead | None = None


class NoteOrganizeRequest(BaseModel):
    original_text: str

    @field_validator("original_text")
    @classmethod
    def original_text_must_not_be_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("original_text must not be empty")

        return value


class NoteOrganizeResponse(BaseModel):
    ai_title: str
    short_summary: str
    tags: list[str]


class NoteDeleteResponse(BaseModel):
    id: int
    deleted: bool
    vector_cleanup: Literal["deleted", "failed"]


class CategoryDeleteResponse(BaseModel):
    id: int
    deleted: bool
    deleted_note_ids: list[int]
    uncategorized_note_ids: list[int] = []
    vector_cleanup: Literal["deleted", "failed"]


class SearchResult(BaseModel):
    id: int
    ai_title: str
    short_summary: str
    tags: list[str]
    date_added: str
    score: float
    category: CategoryRead | None = None
    matched_snippet: str | None = None
    match_type: Literal["exact", "semantic", "hybrid", "fuzzy"]


ASK_HISTORY_MAX_MESSAGES = 10
ASK_HISTORY_CONTENT_MAX_LENGTH = 4000


class AskHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str

    @field_validator("content")
    @classmethod
    def content_must_not_be_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("history content must not be empty")
        if len(stripped_value) > ASK_HISTORY_CONTENT_MAX_LENGTH:
            raise ValueError(
                f"history content must contain at most {ASK_HISTORY_CONTENT_MAX_LENGTH} characters"
            )

        return stripped_value


class AskRequest(BaseModel):
    question: str
    category_id: int | None = None
    uncategorized: bool = False
    note_ids: list[int] | None = None
    history: list[AskHistoryMessage] = []

    @field_validator("question")
    @classmethod
    def question_must_not_be_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("question must not be empty")

        return stripped_value

    @field_validator("note_ids", mode="before")
    @classmethod
    def note_ids_must_be_positive_integers(cls, value: Any) -> list[int] | None:
        if value is None:
            return None
        if not isinstance(value, list):
            raise ValueError("note_ids must be a list")
        if len(value) > 500:
            raise ValueError("note_ids must contain at most 500 values")

        normalized_note_ids: list[int] = []
        seen_note_ids: set[int] = set()
        for note_id in value:
            if type(note_id) is not int or note_id < 1:
                raise ValueError("note_ids must contain positive integers")
            if note_id in seen_note_ids:
                continue

            normalized_note_ids.append(note_id)
            seen_note_ids.add(note_id)

        return normalized_note_ids

    @field_validator("history")
    @classmethod
    def history_must_not_exceed_max_messages(
        cls, value: list[AskHistoryMessage]
    ) -> list[AskHistoryMessage]:
        if len(value) > ASK_HISTORY_MAX_MESSAGES:
            raise ValueError(f"history must contain at most {ASK_HISTORY_MAX_MESSAGES} messages")

        return value

    @field_validator("category_id")
    @classmethod
    def ask_category_id_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("category_id must be positive")

        return value


class AskSourceSnippet(BaseModel):
    text: str
    match_type: Literal["semantic", "exact", "fuzzy", "selected"]
    chunk_index: int | None = None

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("snippet text must not be empty")

        return stripped_value


class AskSource(BaseModel):
    note_id: int
    title: str
    date_added: str
    snippets: list[AskSourceSnippet] = Field(default_factory=list)


class AskResponse(BaseModel):
    answer: str
    sources: list[AskSource]
