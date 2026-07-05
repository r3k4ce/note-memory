import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class ParsedMarkdownNote:
    title: str
    summary: str
    tags: list[str]
    category: str
    body: str


def markdown_filename(*, note_id: int, title: str) -> str:
    slug = _slugify(title) or "note"
    slug = slug[:80].strip("-") or "note"
    return f"{slug}-{note_id}.md"


def serialize_markdown_note(
    *,
    title: str,
    summary: str,
    tags: list[str],
    category: str,
    body: str,
) -> str:
    frontmatter = {
        "title": title,
        "summary": summary,
        "tags": tags,
        "category": category,
    }
    yaml_text = yaml.safe_dump(
        frontmatter,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
    ).strip()
    return f"---\n{yaml_text}\n---\n\n{body}"


def parse_markdown_note(value: str) -> ParsedMarkdownNote:
    normalized_value = value.replace("\r\n", "\n")
    if not normalized_value.startswith("---\n"):
        return ParsedMarkdownNote(
            title="",
            summary="",
            tags=[],
            category="",
            body=value,
        )

    closing_marker_index = normalized_value.find("\n---", 4)
    if closing_marker_index == -1:
        return ParsedMarkdownNote(
            title="",
            summary="",
            tags=[],
            category="",
            body=value,
        )

    closing_marker_end = normalized_value.find("\n", closing_marker_index + 1)
    body_start = closing_marker_end + 1 if closing_marker_end != -1 else len(normalized_value)
    frontmatter_text = normalized_value[4:closing_marker_index]
    loaded = yaml.safe_load(frontmatter_text) or {}
    frontmatter = loaded if isinstance(loaded, dict) else {}

    return ParsedMarkdownNote(
        title=_string_field(frontmatter.get("title")),
        summary=_string_field(frontmatter.get("summary")),
        tags=_normalize_tags(frontmatter.get("tags")),
        category=_string_field(frontmatter.get("category")),
        body=_trim_one_leading_newline(normalized_value[body_start:]),
    )


def write_markdown_note(
    vault_path: Path,
    *,
    note_id: int,
    title: str,
    summary: str,
    tags: list[str],
    category: str,
    body: str,
    previous_relative_path: str | None = None,
) -> str:
    vault_path.mkdir(parents=True, exist_ok=True)
    next_relative_path = markdown_filename(note_id=note_id, title=title)
    next_path = vault_path / next_relative_path
    previous_path = vault_path / previous_relative_path if previous_relative_path else None

    if previous_path is not None and previous_path != next_path and previous_path.exists():
        previous_path.unlink()

    next_path.write_text(
        serialize_markdown_note(
            title=title,
            summary=summary,
            tags=tags,
            category=category,
            body=body,
        )
    )
    return next_relative_path


def delete_markdown_note(vault_path: Path, relative_path: str | None) -> None:
    if relative_path is None:
        return

    path = vault_path / relative_path
    if path.exists():
        path.unlink()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower())
    return slug.strip("-")


def _string_field(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _normalize_tags(value: Any) -> list[str]:
    raw_tags = value if isinstance(value, list) else [value] if isinstance(value, str) else []
    tags: list[str] = []
    seen_tags: set[str] = set()
    for tag in raw_tags:
        if not isinstance(tag, str):
            continue
        normalized_tag = tag.strip().lower()
        if normalized_tag and normalized_tag not in seen_tags:
            tags.append(normalized_tag)
            seen_tags.add(normalized_tag)
    return tags


def _trim_one_leading_newline(value: str) -> str:
    return value[1:] if value.startswith("\n") else value
