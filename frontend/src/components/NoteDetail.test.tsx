import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, test, vi } from "vitest";

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
  test("keeps edit fields controlled while aligning title, properties, body, and summary order", async () => {
    const onSaveEdit = vi.fn().mockResolvedValue(undefined);

    renderDetail({ onSaveEdit });

    const title = screen.getByLabelText("Title");
    const category = screen.getByLabelText("Category");
    const tags = screen.getByLabelText("Tags");
    const body = screen.getByLabelText("Original text");
    const summary = screen.getByLabelText("Summary");

    expect(title.compareDocumentPosition(category)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(category.compareDocumentPosition(body)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(summary.compareDocumentPosition(body)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    expect(screen.getByLabelText("Save changes")).toBeInTheDocument();
    expect(screen.getByLabelText("Cancel edit")).toBeInTheDocument();
    expect(screen.getByLabelText("New note")).toBeInTheDocument();
    expect(screen.getByLabelText("Delete note")).toBeInTheDocument();

    fireEvent.change(title, { target: { value: "Updated title" } });
    fireEvent.change(category, { target: { value: "2" } });
    fireEvent.change(tags, { target: { value: "gamma, gamma, delta" } });
    fireEvent.change(body, { target: { value: "Updated body" } });
    fireEvent.change(summary, { target: { value: "Updated summary" } });
    fireEvent.click(screen.getByLabelText("Save changes"));

    expect(onSaveEdit).toHaveBeenCalledWith({
      original_text: "Updated body",
      ai_title: "Updated title",
      short_summary: "Updated summary",
      tags: ["gamma", "delta"],
      category_id: 2,
    });
  });
});
