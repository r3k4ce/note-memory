from mapping_memory.markdown_notes import (
    ParsedMarkdownNote,
    markdown_filename,
    parse_markdown_note,
    serialize_markdown_note,
)


def test_serialize_markdown_note_writes_obsidian_style_yaml_frontmatter() -> None:
    text = serialize_markdown_note(
        title="My Note",
        summary="Short summary.",
        tags=["work", "project"],
        category="Work",
        body="Body text\nSecond line",
    )

    assert text == (
        "---\n"
        "title: My Note\n"
        "summary: Short summary.\n"
        "tags:\n"
        "- work\n"
        "- project\n"
        "category: Work\n"
        "---\n"
        "\n"
        "Body text\n"
        "Second line"
    )


def test_parse_markdown_note_reads_yaml_frontmatter_and_lowercases_tags() -> None:
    parsed = parse_markdown_note(
        "---\n"
        "title: Imported Note\n"
        "summary: Imported summary.\n"
        "tags:\n"
        "  - Work\n"
        "  - work\n"
        "  - Mapping\n"
        "category: Projects\n"
        "---\n"
        "\n"
        "Imported body"
    )

    assert parsed == ParsedMarkdownNote(
        title="Imported Note",
        summary="Imported summary.",
        tags=["work", "mapping"],
        category="Projects",
        body="Imported body",
    )


def test_markdown_filename_uses_slugged_title_and_id() -> None:
    assert markdown_filename(note_id=42, title="  My Routed Note!  ") == "my-routed-note-42.md"


def test_markdown_filename_falls_back_to_note_id_for_blank_title() -> None:
    assert markdown_filename(note_id=7, title="   ") == "note-7.md"
