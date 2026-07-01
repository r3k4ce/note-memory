from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class CategoryCreate(BaseModel):
    name: str

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
    category_id: int | None = None

    @field_validator("original_text")
    @classmethod
    def original_text_must_not_be_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("original_text must not be empty")

        return value

    @field_validator("category_id")
    @classmethod
    def category_id_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("category_id must be positive")

        return value


class NoteUpdate(BaseModel):
    ai_title: str | None = None
    short_summary: str | None = None
    tags: list[str] | None = None
    category_id: int | None = None

    model_config = ConfigDict(extra="forbid")

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
            raise ValueError("at least one metadata field must be provided")

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


class NoteDeleteResponse(BaseModel):
    id: int
    deleted: bool
    vector_cleanup: Literal["deleted", "failed"]


class SearchResult(BaseModel):
    id: int
    ai_title: str
    short_summary: str
    tags: list[str]
    date_added: str
    score: float
    category: CategoryRead | None = None


class AskRequest(BaseModel):
    question: str

    @field_validator("question")
    @classmethod
    def question_must_not_be_empty(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("question must not be empty")

        return stripped_value


class AskSource(BaseModel):
    note_id: int
    title: str
    date_added: str


class AskResponse(BaseModel):
    answer: str
    sources: list[AskSource]
