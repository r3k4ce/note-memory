import math
import re
from dataclasses import dataclass
from typing import Literal

SHORT_NOTE_MAX_TOKENS = 300
CONTENT_TARGET_TOKENS = 650
CONTENT_HARD_MAX_TOKENS = 900

ChunkType = Literal["full", "summary", "content"]


@dataclass(frozen=True)
class RetrievalChunk:
    note_id: int
    chunk_index: int
    chunk_type: ChunkType
    text: str
    title: str
    tags: tuple[str, ...]
    date_added: str
    source_start: int | None
    source_end: int | None
    category_id: int | None = None
    category_name: str | None = None


@dataclass(frozen=True)
class _TextSegment:
    text: str
    source_start: int
    source_end: int


def create_retrieval_chunks(
    *,
    note_id: int,
    original_text: str,
    ai_title: str,
    short_summary: str,
    tags: list[str],
    date_added: str,
    category_id: int | None = None,
    category_name: str | None = None,
) -> list[RetrievalChunk]:
    chunk_tags = tuple(tags)

    if _approximate_token_count(original_text) <= SHORT_NOTE_MAX_TOKENS:
        return [
            _build_chunk(
                note_id=note_id,
                chunk_index=0,
                chunk_type="full",
                body=original_text,
                title=ai_title,
                summary=short_summary,
                tags=chunk_tags,
                date_added=date_added,
                source_start=0,
                source_end=len(original_text),
                category_id=category_id,
                category_name=category_name,
            )
        ]

    chunks = [
        _build_chunk(
            note_id=note_id,
            chunk_index=0,
            chunk_type="summary",
            body=short_summary,
            title=ai_title,
            summary=short_summary,
            tags=chunk_tags,
            date_added=date_added,
            source_start=None,
            source_end=None,
            category_id=category_id,
            category_name=category_name,
        )
    ]

    for content_group in _group_content_segments(_content_segments(original_text)):
        chunks.append(
            _build_chunk(
                note_id=note_id,
                chunk_index=len(chunks),
                chunk_type="content",
                body="\n\n".join(segment.text for segment in content_group),
                title=ai_title,
                summary=short_summary,
                tags=chunk_tags,
                date_added=date_added,
                source_start=content_group[0].source_start,
                source_end=content_group[-1].source_end,
                category_id=category_id,
                category_name=category_name,
            )
        )

    return chunks


def _build_chunk(
    *,
    note_id: int,
    chunk_index: int,
    chunk_type: ChunkType,
    body: str,
    title: str,
    summary: str,
    tags: tuple[str, ...],
    date_added: str,
    source_start: int | None,
    source_end: int | None,
    category_id: int | None,
    category_name: str | None,
) -> RetrievalChunk:
    return RetrievalChunk(
        note_id=note_id,
        chunk_index=chunk_index,
        chunk_type=chunk_type,
        text=_format_chunk_text(
            title=title,
            tags=tags,
            date_added=date_added,
            summary=summary,
            body=body,
        ),
        title=title,
        tags=tags,
        date_added=date_added,
        source_start=source_start,
        source_end=source_end,
        category_id=category_id,
        category_name=category_name,
    )


def _format_chunk_text(
    *,
    title: str,
    tags: tuple[str, ...],
    date_added: str,
    summary: str,
    body: str,
) -> str:
    rendered_tags = ", ".join(tags) if tags else "none"
    return (
        f"Title: {title}\n"
        f"Tags: {rendered_tags}\n"
        f"Date added: {date_added}\n"
        f"Summary: {summary}\n"
        f"Chunk: {body}"
    )


def _content_segments(original_text: str) -> list[_TextSegment]:
    segments: list[_TextSegment] = []
    for paragraph in _paragraph_segments(original_text):
        if _approximate_token_count(paragraph.text) <= CONTENT_HARD_MAX_TOKENS:
            segments.append(paragraph)
        else:
            segments.extend(_split_large_paragraph(paragraph))

    return segments


def _paragraph_segments(original_text: str) -> list[_TextSegment]:
    segments: list[_TextSegment] = []
    for match in re.finditer(r"\S[\s\S]*?(?=\n\s*\n|\Z)", original_text):
        text = match.group(0).rstrip()
        segments.append(
            _TextSegment(
                text=text,
                source_start=match.start(),
                source_end=match.start() + len(text),
            )
        )

    return segments


def _split_large_paragraph(paragraph: _TextSegment) -> list[_TextSegment]:
    segments: list[_TextSegment] = []
    for sentence in _sentence_segments(paragraph):
        if _approximate_token_count(sentence.text) <= CONTENT_HARD_MAX_TOKENS:
            segments.append(sentence)
        else:
            segments.extend(_word_window_segments(sentence))

    return segments


def _sentence_segments(paragraph: _TextSegment) -> list[_TextSegment]:
    segments: list[_TextSegment] = []
    for match in re.finditer(r"[^.!?]+[.!?]+|[^.!?]+$", paragraph.text):
        text = match.group(0).strip()
        if not text:
            continue

        leading_space_count = len(match.group(0)) - len(match.group(0).lstrip())
        source_start = paragraph.source_start + match.start() + leading_space_count
        segments.append(
            _TextSegment(
                text=text,
                source_start=source_start,
                source_end=source_start + len(text),
            )
        )

    return segments


def _word_window_segments(sentence: _TextSegment) -> list[_TextSegment]:
    words = list(re.finditer(r"\S+", sentence.text))
    if not words:
        return []

    max_words = max(1, math.floor(CONTENT_TARGET_TOKENS * 0.75))
    segments: list[_TextSegment] = []
    for window_start in range(0, len(words), max_words):
        window = words[window_start : window_start + max_words]
        source_start = sentence.source_start + window[0].start()
        source_end = sentence.source_start + window[-1].end()
        segments.append(
            _TextSegment(
                text=" ".join(word.group(0) for word in window),
                source_start=source_start,
                source_end=source_end,
            )
        )

    return segments


def _group_content_segments(segments: list[_TextSegment]) -> list[list[_TextSegment]]:
    groups: list[list[_TextSegment]] = []
    current_group: list[_TextSegment] = []
    current_text = ""

    for segment in segments:
        next_text = segment.text if not current_text else f"{current_text}\n\n{segment.text}"
        if current_group and _approximate_token_count(next_text) > CONTENT_TARGET_TOKENS:
            groups.append(current_group)
            current_group = [segment]
            current_text = segment.text
        else:
            current_group.append(segment)
            current_text = next_text

    if current_group:
        groups.append(current_group)

    return groups


def _approximate_token_count(text: str) -> int:
    word_count = len(re.findall(r"\S+", text))
    return math.ceil(word_count / 0.75)
