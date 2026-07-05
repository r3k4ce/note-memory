import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { Note } from "../types";
import { NoteDetail } from "./NoteDetail";
import type { MarkdownPaneProps } from "./MarkdownPane";

vi.mock("./MarkdownPane", () => ({
  MarkdownPane({ disabled, id, mode, onChange, value }: MarkdownPaneProps) {
    if (mode === "read") {
      return <div>{value}</div>;
    }

    return (
      <textarea
        aria-label="Markdown source"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange?.(event.target.value)}
        value={value}
      />
    );
  },
}));

afterEach(() => {
  cleanup();
});

const categories = [
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

function renderDetail(props: Partial<ComponentProps<typeof NoteDetail>> = {}) {
  const defaultProps: ComponentProps<typeof NoteDetail> = {
    categories,
    deleteError: null,
    editError: null,
    error: null,
    isDeleting: false,
    isLoading: false,
    isSavingEdit: false,
    mode: "edit-selected",
    note,
    onCancelEdit: vi.fn(),
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    onEditDirtyChange: vi.fn(),
    onNewNote: vi.fn(),
    onSaveEdit: vi.fn().mockResolvedValue(undefined),
  };

  return render(<NoteDetail {...defaultProps} {...props} />);
}

describe("NoteDetail selected-note editing", () => {
  test("edits saved-note fields through one frontmatter markdown document", async () => {
    const onSaveEdit = vi.fn().mockResolvedValue(undefined);

    renderDetail({ onSaveEdit });

    const editor = screen.getByLabelText("Markdown source");

    expect(editor).toHaveValue(
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

    expect(screen.getByLabelText("Save changes")).toBeInTheDocument();
    expect(screen.getByLabelText("Cancel edit")).toBeInTheDocument();
    expect(screen.getByLabelText("New note")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete note")).toBeInTheDocument();

    fireEvent.change(editor, {
      target: {
        value: [
          "---",
          "title: Updated title",
          "summary: Updated summary",
          "tags: gamma, gamma, delta",
          "category: Personal",
          "---",
          "",
          "Updated body",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByLabelText("Save changes"));

    expect(onSaveEdit).toHaveBeenCalledWith({
      original_text: "Updated body",
      ai_title: "Updated title",
      short_summary: "Updated summary",
      tags: ["gamma", "delta"],
      category_id: 2,
    });
  });

  test("regenerates frontmatter from the current body draft without saving", async () => {
    const onRegenerateDetails = vi.fn().mockResolvedValue({
      ai_title: "AI title",
      short_summary: "AI summary.",
      tags: ["ai", "draft"],
    });
    const onSaveEdit = vi.fn().mockResolvedValue(undefined);

    renderDetail({ onRegenerateDetails, onSaveEdit });

    const editor = screen.getByLabelText("Markdown source");
    fireEvent.change(editor, {
      target: {
        value: [
          "---",
          "title: Initial title",
          "summary: Initial summary",
          "tags: alpha, beta",
          "category: Work",
          "---",
          "",
          "Unsaved body",
        ].join("\n"),
      },
    });
    fireEvent.click(screen.getByLabelText("Regenerate details"));

    await waitFor(() => {
      expect(onRegenerateDetails).toHaveBeenCalledWith("Unsaved body");
    });
    expect((editor as HTMLTextAreaElement).value).toContain("title: AI title");
    expect((editor as HTMLTextAreaElement).value).toContain("summary: AI summary.");
    expect((editor as HTMLTextAreaElement).value).toContain("tags: ai, draft");
    expect((editor as HTMLTextAreaElement).value).toContain("Unsaved body");
    expect(onSaveEdit).not.toHaveBeenCalled();
  });
});
