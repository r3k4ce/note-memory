import json
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
    ai_organization_completed: Literal[True] = True

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
    needs_ai_organization: bool


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


class AskRequest(BaseModel):
    question: str
    thread_id: int | None = None
    category_id: int | None = None
    uncategorized: bool = False
    note_ids: list[int] | None = None

    model_config = ConfigDict(extra="forbid")

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

    @field_validator("category_id")
    @classmethod
    def ask_category_id_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("category_id must be positive")

        return value

    @field_validator("thread_id")
    @classmethod
    def thread_id_must_be_positive(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("thread_id must be positive")

        return value


class AskSourceSnippet(BaseModel):
    text: str
    match_type: Literal["semantic", "exact", "fuzzy", "selected"]
    chunk_index: int | None = None
    chunk_type: Literal["full", "summary", "content"] | None = None
    source_start: int | None = None
    source_end: int | None = None

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


class AskEvidenceSummary(BaseModel):
    source_count: int
    snippet_count: int
    match_types: list[Literal["semantic", "exact", "fuzzy", "selected"]]


class AskResponse(BaseModel):
    answer: str
    status: Literal["answered", "no_evidence"]
    evidence_summary: AskEvidenceSummary
    sources: list[AskSource]
    memory_updates: int = 0


class AssistantSourceSnapshot(BaseModel):
    source_id: str
    source_type: Literal["note", "web"]
    title: str
    source_date: str | None = None
    cited_snippet: str = Field(max_length=360)
    citation_order: int = Field(ge=1)
    note_id: int | None = None
    source_start: int | None = None
    source_end: int | None = None
    note_version_updated_at: str | None = None
    url: str | None = None

    @field_validator("source_id", "title", "cited_snippet")
    @classmethod
    def required_text_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value

    @field_validator("source_date", "note_version_updated_at", "url")
    @classmethod
    def optional_text_must_not_be_blank(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value

    @model_validator(mode="after")
    def source_type_must_match_identity(self) -> "AssistantSourceSnapshot":
        note_values = (
            self.note_id,
            self.source_start,
            self.source_end,
            self.note_version_updated_at,
        )
        if self.source_type == "note":
            if (
                self.note_id is None
                or self.note_id < 1
                or self.source_start is None
                or self.source_start < 0
                or self.source_end is None
                or self.source_end < self.source_start
                or self.note_version_updated_at is None
                or self.url is not None
            ):
                raise ValueError("note sources require note identity and cannot have a URL")
        elif self.url is None or any(value is not None for value in note_values):
            raise ValueError("web sources require a URL and cannot have note identity")
        return self


class AssistantClaim(BaseModel):
    claim_id: str
    text: str
    source_ids: list[str]

    @field_validator("claim_id", "text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value

    @field_validator("source_ids")
    @classmethod
    def source_ids_must_be_unique_and_nonblank(cls, value: list[str]) -> list[str]:
        if not value:
            raise ValueError("claims must reference at least one source")
        normalized = [source_id.strip() for source_id in value]
        if any(not source_id for source_id in normalized):
            raise ValueError("source IDs must not be blank")
        if len(set(normalized)) != len(normalized):
            raise ValueError("claim source IDs must be unique")
        return normalized


class AssistantValidationResult(BaseModel):
    result_id: str
    kind: Literal["code", "semantic"]
    outcome: Literal["passed", "failed"]
    details: dict[str, Any]

    @field_validator("result_id")
    @classmethod
    def result_id_must_not_be_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("result_id must not be blank")
        return value

    @field_validator("details")
    @classmethod
    def details_must_fit_storage_limit(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            serialized = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
        except (TypeError, ValueError) as error:
            raise ValueError("details must be JSON serializable") from error
        if len(serialized.encode()) > 4096:
            raise ValueError("details must serialize to at most 4 KiB")
        return value


class AssistantReplyAudit(BaseModel):
    sources: list[AssistantSourceSnapshot] = Field(default_factory=list)
    claims: list[AssistantClaim] = Field(default_factory=list)
    validation_results: list[AssistantValidationResult] = Field(default_factory=list)

    @model_validator(mode="after")
    def audit_ids_and_mappings_must_be_consistent(self) -> "AssistantReplyAudit":
        source_ids = [source.source_id for source in self.sources]
        claim_ids = [claim.claim_id for claim in self.claims]
        result_ids = [result.result_id for result in self.validation_results]
        citation_orders = [source.citation_order for source in self.sources]
        if len(set(source_ids)) != len(source_ids):
            raise ValueError("source IDs must be unique within an assistant reply")
        if len(set(citation_orders)) != len(citation_orders):
            raise ValueError("citation orders must be unique within an assistant reply")
        if len(set(claim_ids)) != len(claim_ids):
            raise ValueError("claim IDs must be unique within an assistant reply")
        if len(set(result_ids)) != len(result_ids):
            raise ValueError("validation result IDs must be unique within an assistant reply")
        known_sources = set(source_ids)
        if any(
            source_id not in known_sources
            for claim in self.claims
            for source_id in claim.source_ids
        ):
            raise ValueError("claims must reference a known source ID")
        return self


class ChatMessageRead(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    created_at: str
    status: (
        Literal["pending", "completed", "failed", "timed_out", "interrupted", "cancelled"] | None
    ) = None
    evidence_summary: AskEvidenceSummary | None = None
    sources: list[AskSource] = Field(default_factory=list)


class ChatThreadCreate(BaseModel):
    title: str | None = None
    scope: dict[str, Any] | None = None

    model_config = ConfigDict(extra="forbid")


class ChatThreadUpdate(BaseModel):
    title: str | None = None
    scope: dict[str, Any] | None = None

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def at_least_one_field(self) -> "ChatThreadUpdate":
        if not self.model_fields_set:
            raise ValueError("at least one update field must be provided")

        return self


class ChatThreadRead(BaseModel):
    id: int
    title: str
    scope: dict[str, Any]
    created_at: str
    updated_at: str


class MemoryRecord(BaseModel):
    id: str
    content: str
    created_at: str | None = None
    updated_at: str | None = None


class MemoryUpdate(BaseModel):
    content: str

    @field_validator("content")
    @classmethod
    def content_must_not_be_blank(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("memory content must not be empty")
        return stripped_value


class MemorySettingsRead(BaseModel):
    available: bool
    learning_enabled: bool


class MemorySettingsUpdate(BaseModel):
    learning_enabled: bool
