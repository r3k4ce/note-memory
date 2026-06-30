from mapping_memory.chunking import create_retrieval_chunks


def test_short_note_creates_one_full_card_chunk() -> None:
    chunks = create_retrieval_chunks(
        note_id=42,
        original_text="Short mapping note.\nSecond line.",
        ai_title="Short title",
        short_summary="Short summary.",
        tags=["routing"],
        date_added="2026-06-30T23:30:00+00:00",
    )

    assert len(chunks) == 1
    assert chunks[0].chunk_type == "full"
    assert chunks[0].chunk_index == 0
    assert "Chunk: Short mapping note.\nSecond line." in chunks[0].text


def test_long_note_creates_summary_chunk_plus_content_chunks() -> None:
    paragraph = " ".join(f"mapping detail {index}" for index in range(120))
    original_text = "\n\n".join([paragraph, paragraph, paragraph])

    chunks = create_retrieval_chunks(
        note_id=7,
        original_text=original_text,
        ai_title="Long title",
        short_summary="Long summary.",
        tags=["layers", "labels"],
        date_added="2026-06-30T23:30:00+00:00",
    )

    assert len(chunks) > 1
    assert chunks[0].chunk_type == "summary"
    assert chunks[0].text.endswith("Chunk: Long summary.")
    assert [chunk.chunk_type for chunk in chunks[1:]] == ["content", "content", "content"]


def test_chunks_include_title_tags_date_header() -> None:
    chunks = create_retrieval_chunks(
        note_id=3,
        original_text="Header note body.",
        ai_title="Header title",
        short_summary="Header summary.",
        tags=["routing", "labels"],
        date_added="2026-06-30T23:30:00+00:00",
    )

    assert chunks[0].text.startswith(
        "Title: Header title\n"
        "Tags: routing, labels\n"
        "Date added: 2026-06-30T23:30:00+00:00\n"
        "Summary: Header summary.\n"
        "Chunk: "
    )


def test_chunks_include_note_id_and_chunk_index_metadata() -> None:
    paragraph = " ".join(f"metadata detail {index}" for index in range(120))
    chunks = create_retrieval_chunks(
        note_id=99,
        original_text="\n\n".join([paragraph, paragraph]),
        ai_title="Metadata title",
        short_summary="Metadata summary.",
        tags=["metadata", "retrieval"],
        date_added="2026-06-30T23:30:00+00:00",
    )

    assert [chunk.note_id for chunk in chunks] == [99] * len(chunks)
    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert [chunk.chunk_type for chunk in chunks] == ["summary", "content", "content"]
    assert [chunk.title for chunk in chunks] == ["Metadata title"] * len(chunks)
    assert [chunk.tags for chunk in chunks] == [("metadata", "retrieval")] * len(chunks)
    assert [chunk.date_added for chunk in chunks] == ["2026-06-30T23:30:00+00:00"] * len(chunks)
