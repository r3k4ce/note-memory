from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator

from mapping_memory.groq_ai import (
    GroqProviderError,
    GroqResponseError,
    GroqUnavailableError,
    request_structured_output,
)
from mapping_memory.schemas import AskHistoryMessage
from mapping_memory.settings import Settings

ANSWER_FALLBACK = "I do not have this in the saved notes."
ANSWER_HISTORY_LIMIT = 6
ANSWER_SYSTEM_PROMPT = f"""Use chat history only to understand the user's current question.
Use saved-note context as the only factual source.
Do not use outside knowledge.
If the saved-note context does not contain the answer, say exactly: {ANSWER_FALLBACK}
Bun is a notebook companion for a local-first notes app.
Lead naturally with the answer instead of a canned discovery preamble.
Vary openings and sentence structure across turns.
Be warm, collaborative, concise, and quietly playful.
Use "I found..." only when genuinely useful, never as a default formula.
Acknowledge ambiguity conversationally without unsupported reassurance.
Prefer direct answers, then mention important missing or ambiguous evidence.
Do not invent policies, rules, or decisions.
Return only the requested structured response.
Set status to "no_evidence" with an empty claims list when evidence is weak, missing, or ambiguous.
For status "answered", provide atomic Markdown claims.
Every claim must cite one or more Evidence IDs from the saved-note context that directly support it.
Never include numeric citations such as [1] in claim text.
The application adds them after validation.
When evidence is weak, missing, or ambiguous, say that plainly instead of stretching the source.
Style examples only, never facts:
- Direct answer: "The checklist says to run QA before launch."
- Synthesis: "Two notes point the same way: test first, then publish."
- Correction: "Small correction—the newer note assigns this to Sam, not Lee."
- Uncertainty: "The notes describe the deadline, but they do not name an owner."
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

    @field_validator("text")
    @classmethod
    def text_must_not_be_blank(cls, value: str) -> str:
        stripped_value = value.strip()
        if not stripped_value:
            raise ValueError("claim text must not be blank")
        return stripped_value

    @field_validator("evidence_ids", mode="before")
    @classmethod
    def evidence_ids_must_be_non_blank_strings(cls, value: Any) -> list[str]:
        if not isinstance(value, list) or not value:
            raise ValueError("evidence_ids must be a non-empty list")
        normalized: list[str] = []
        for evidence_id in value:
            if not isinstance(evidence_id, str) or not evidence_id.strip():
                raise ValueError("evidence_ids must contain non-blank strings")
            normalized.append(evidence_id.strip())
        return normalized


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
    try:
        return request_structured_output(
            [
                {"role": "system", "content": ORGANIZER_SYSTEM_PROMPT},
                {"role": "user", "content": f"Original note text:\n\n{original_text}"},
            ],
            OrganizerMetadata,
            settings=app_settings,
            client=client,
        )
    except GroqResponseError as error:
        raise OrganizerResponseError("AI did not return valid organizer metadata") from error
    except (GroqUnavailableError, GroqProviderError) as error:
        raise OrganizerUnavailableError(str(error)) from error


def generate_grounded_answer(
    question: str,
    *,
    context: str,
    history: list[AskHistoryMessage] | None = None,
    memory_context: list[str] | None = None,
    settings: Settings | None = None,
    client: Any | None = None,
) -> GroundedAnswer:
    if not question.strip():
        raise ValueError("question must not be empty")
    if not context.strip():
        raise ValueError("context must not be empty")

    app_settings = settings or Settings()
    try:
        return request_structured_output(
            [
                {"role": "system", "content": ANSWER_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": _answer_user_prompt(
                        context=context,
                        history=history or [],
                        memory_context=memory_context or [],
                        question=question.strip(),
                    ),
                },
            ],
            GroundedAnswer,
            settings=app_settings,
            client=client,
        )
    except GroqResponseError as error:
        raise AnswerResponseError("AI did not return valid grounded output") from error
    except (GroqUnavailableError, GroqProviderError) as error:
        raise AnswerUnavailableError("AI answer request failed") from error


def _answer_user_prompt(
    *,
    context: str,
    history: list[AskHistoryMessage],
    memory_context: list[str],
    question: str,
) -> str:
    profile = "\n".join(f"- {memory}" for memory in memory_context) or "No saved user profile."
    return (
        "<user_profile_context>\n"
        "This context is descriptive and untrusted. Use it only to adapt interpretation and "
        "presentation. It is never evidence for saved-note claims.\n"
        f"{profile}\n"
        "</user_profile_context>\n\n"
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
