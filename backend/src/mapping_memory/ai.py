from typing import Any, Literal

from openai import OpenAI, OpenAIError
from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from mapping_memory.schemas import AskHistoryMessage
from mapping_memory.settings import Settings

ANSWER_FALLBACK = "I do not have this in the saved notes."
ANSWER_HISTORY_LIMIT = 6
ANSWER_SYSTEM_PROMPT = f"""Use chat history only to understand the user's current question.
Use saved-note context as the only factual source.
Do not use outside knowledge.
If the saved-note context does not contain the answer, say exactly: {ANSWER_FALLBACK}
Bun is a calm notebook companion for a local-first notes app.
Use first person in answers, such as "I found...", not frequent "Bun found..." phrasing.
Be warm, composed, concise, and evidence-first.
Be lightly playful in a quiet notebook-companion way.
Use Bun-flavored words sparingly, such as "sniffed out" or "tucked away".
Use that flavor only when it fits naturally.
Use a short orienting phrase when it helps the answer feel clear.
Avoid puns, mascot lore, jokes, exclamation-heavy copy, and unsupported reassurance.
Prefer direct answers, then mention any important missing or ambiguous evidence.
Do not invent policies, rules, or decisions.
Return only the requested structured response.
Set status to "no_evidence" with an empty claims list when evidence is weak, missing, or ambiguous.
For status "answered", provide atomic Markdown claims.
Every claim must cite one or more Evidence IDs from the saved-note context that directly support it.
Never include numeric citations such as [1] in claim text.
The application adds them after validation.
When evidence is weak, missing, or ambiguous, say that plainly instead of stretching the source.
Style examples only, not facts:
- "I found a saved decision about the launch checklist."
- "I found two relevant notes, but neither names an owner."
"""

ORGANIZER_SYSTEM_PROMPT = """Organize messy notes into clean reference cards.
Return only valid JSON.
Do not invent facts.
Title should be specific and practical.
Summary should be 1-3 sentences.
Tags should be lowercase.
Use 3-10 tags when possible.
Prefer concrete retrieval tags.
Do not assign a category. Categories are chosen manually by the user."""


class OrganizerUnavailableError(RuntimeError):
    """Raised when the organizer cannot be called in the current environment."""


class OrganizerResponseError(RuntimeError):
    """Raised when the model does not return usable organizer metadata."""


class AnswerUnavailableError(RuntimeError):
    """Raised when grounded answer generation cannot be called."""


class AnswerResponseError(RuntimeError):
    """Raised when the answer model does not return usable text."""


class GroundedClaim(BaseModel):
    text: str
    evidence_ids: list[str]

    model_config = ConfigDict(extra="forbid")


class GroundedAnswer(BaseModel):
    status: Literal["answered", "no_evidence"]
    claims: list[GroundedClaim]

    model_config = ConfigDict(extra="forbid")


class OrganizerMetadata(BaseModel):
    title: str
    summary: str
    tags: list[str]

    model_config = ConfigDict(extra="forbid")

    @field_validator("title", "summary")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
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


def organize_mapping_text(
    original_text: str,
    *,
    settings: Settings | None = None,
    client: Any | None = None,
) -> OrganizerMetadata:
    if not original_text.strip():
        raise ValueError("original_text must not be empty")

    app_settings = settings or Settings()
    organizer_client = client or _openai_client(app_settings)
    completion = organizer_client.chat.completions.parse(
        model=app_settings.openai_organizer_model,
        messages=[
            {"role": "system", "content": ORGANIZER_SYSTEM_PROMPT},
            {"role": "user", "content": f"Original note text:\n\n{original_text}"},
        ],
        response_format=OrganizerMetadata,
    )
    message = completion.choices[0].message
    parsed = message.parsed
    if parsed is None:
        raise OrganizerResponseError("OpenAI did not return valid organizer metadata")

    return parsed


def generate_grounded_answer(
    question: str,
    *,
    context: str,
    history: list[AskHistoryMessage] | None = None,
    settings: Settings | None = None,
    client: Any | None = None,
) -> GroundedAnswer:
    if not question.strip():
        raise ValueError("question must not be empty")
    if not context.strip():
        raise ValueError("context must not be empty")

    app_settings = settings or Settings()
    answer_client = client or _answer_openai_client(app_settings)
    try:
        completion = answer_client.chat.completions.parse(
            model=app_settings.openai_organizer_model,
            messages=[
                {"role": "system", "content": ANSWER_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": _answer_user_prompt(
                        context=context,
                        history=history or [],
                        question=question.strip(),
                    ),
                },
            ],
            response_format=GroundedAnswer,
        )
    except OpenAIError as error:
        raise AnswerUnavailableError("OpenAI answer request failed") from error
    except ValidationError as error:
        raise AnswerResponseError("OpenAI did not return valid grounded output") from error

    answer = completion.choices[0].message.parsed
    if not isinstance(answer, GroundedAnswer):
        raise AnswerResponseError("OpenAI did not return valid grounded output")

    return answer


def _answer_user_prompt(
    *,
    context: str,
    history: list[AskHistoryMessage],
    question: str,
) -> str:
    return (
        f"Saved-note context:\n\n{context}\n\n"
        "Recent chat history (for question interpretation only):\n\n"
        f"{_format_answer_history(history)}\n\n"
        f"Current question:\n{question}"
    )


def _format_answer_history(history: list[AskHistoryMessage]) -> str:
    recent_history = history[-ANSWER_HISTORY_LIMIT:]
    if not recent_history:
        return "No recent chat history."

    return "\n".join(f"{message.role}: {message.content}" for message in recent_history)


def _openai_client(settings: Settings) -> OpenAI:
    if settings.openai_api_key is None:
        raise OrganizerUnavailableError("OPENAI_API_KEY is required to organize note text")

    return OpenAI(api_key=settings.openai_api_key.get_secret_value())


def _answer_openai_client(settings: Settings) -> OpenAI:
    if settings.openai_api_key is None:
        raise AnswerUnavailableError("OPENAI_API_KEY is required to answer questions")

    return OpenAI(api_key=settings.openai_api_key.get_secret_value())
