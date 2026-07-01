from pydantic import BaseModel, field_validator


class NoteCreate(BaseModel):
    original_text: str

    @field_validator("original_text")
    @classmethod
    def original_text_must_not_be_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("original_text must not be empty")

        return value


class NoteRead(BaseModel):
    id: int
    original_text: str
    ai_title: str
    short_summary: str
    tags: list[str]
    date_added: str
    updated_at: str


class SearchResult(BaseModel):
    id: int
    ai_title: str
    short_summary: str
    tags: list[str]
    date_added: str
    score: float


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
