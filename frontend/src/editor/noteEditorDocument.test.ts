import { describe, expect, test } from "vitest";

import type { Category, Note } from "../types";
import {
  createBlankNoteEditorDocument,
  parseDraftNoteEditorDocument,
  parseNoteEditorDocument,
  serializeNoteEditorDocument,
  updateNoteEditorDocumentMetadata,
} from "./noteEditorDocument";

const categories: Category[] = [
  { id: 1, name: "Work", slug: "work", created_at: "2026-07-01", updated_at: "2026-07-01" },
  { id: 2, name: "Personal", slug: "personal", created_at: "2026-07-02", updated_at: "2026-07-02" },
];

const note: Note = {
  id: 42,
  original_text: "Initial body",
  ai_title: "Initial title",
  short_summary: "Initial summary",
  tags: ["alpha", "beta"],
  date_added: "2026-07-03",
  updated_at: "2026-07-04",
  category: categories[0],
};

describe("note editor document helpers", () => {
  test("serializes saved note metadata as frontmatter above the body", () => {
    expect(serializeNoteEditorDocument(note)).toBe(
      [
        "---",
        "title: Initial title",
        "summary: Initial summary",
        "tags: alpha, beta",
        "category: Work",
        "---",
        "",
        "Initial body",
      ].join("\n"),
    );
  });

  test("parses frontmatter into note update fields without keeping it in the body", () => {
    const parsed = parseNoteEditorDocument(
      [
        "---",
        "title: Updated title",
        "summary: Updated summary",
        "tags: Gamma, gamma, Delta",
        "category: Personal",
        "---",
        "",
        "Updated body",
      ].join("\n"),
      note,
      categories,
    );

    expect(parsed).toEqual({
      update: {
        original_text: "Updated body",
        ai_title: "Updated title",
        short_summary: "Updated summary",
        tags: ["gamma", "delta"],
        category_id: 2,
      },
      categoryNameToCreate: null,
    });
  });

  test("preserves existing metadata when the whole frontmatter block is missing", () => {
    expect(parseNoteEditorDocument("Body only", note, categories)).toEqual({
      update: {
        original_text: "Body only",
        ai_title: "Initial title",
        short_summary: "Initial summary",
        tags: ["alpha", "beta"],
        category_id: 1,
      },
      categoryNameToCreate: null,
    });
  });

  test("uses smart blanks for existing-note metadata fields", () => {
    const parsed = parseNoteEditorDocument(
      ["---", "title:", "summary:", "tags:", "category:", "---", "", "Body"].join("\n"),
      note,
      categories,
    );

    expect(parsed).toEqual({
      update: {
        original_text: "Body",
        ai_title: "Initial title",
        short_summary: "Initial summary",
        tags: [],
        category_id: null,
      },
      categoryNameToCreate: null,
    });
  });

  test("returns a category name to create when frontmatter uses an unknown category", () => {
    expect(
      parseNoteEditorDocument(
        ["---", "title: T", "summary: S", "tags: a", "category: Research", "---", "", "Body"].join("\n"),
        note,
        categories,
      ),
    ).toEqual({
      update: {
        original_text: "Body",
        ai_title: "T",
        short_summary: "S",
        tags: ["a"],
        category_id: null,
      },
      categoryNameToCreate: "Research",
    });
  });

  test("updates only frontmatter metadata while preserving the current body draft", () => {
    const updatedDocument = updateNoteEditorDocumentMetadata(
      serializeNoteEditorDocument(note).replace("Initial body", "Unsaved body"),
      note,
      {
        ai_title: "AI title",
        short_summary: "AI summary.",
        tags: ["ai", "draft"],
      },
    );

    expect(updatedDocument).toContain("title: AI title");
    expect(updatedDocument).toContain("summary: AI summary.");
    expect(updatedDocument).toContain("tags: ai, draft");
    expect(updatedDocument).toContain("category: Work");
    expect(updatedDocument.endsWith("Unsaved body")).toBe(true);
  });

  test("creates a blank draft document with editable frontmatter", () => {
    expect(createBlankNoteEditorDocument()).toBe(
      ["---", "title: ", "summary: ", "tags: ", "category: ", "---", ""].join("\n"),
    );
  });

  test("parses a new-note draft frontmatter document", () => {
    expect(
      parseDraftNoteEditorDocument(
        [
          "---",
          "title: Draft title",
          "summary: Draft summary.",
          "tags: Work, Mapping",
          "category: Work",
          "---",
          "",
          "Draft body",
        ].join("\n"),
        categories,
      ),
    ).toEqual({
      update: {
        original_text: "Draft body",
        ai_title: "Draft title",
        short_summary: "Draft summary.",
        tags: ["work", "mapping"],
        category_id: 1,
      },
      categoryNameToCreate: null,
    });
  });
});
