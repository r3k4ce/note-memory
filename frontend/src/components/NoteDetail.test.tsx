import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { Note } from "../types";
import { NoteDetail } from "./NoteDetail";
import type { MarkdownPaneProps } from "./MarkdownPane";

vi.mock("./MarkdownPane", () => ({
  MarkdownPane({
    disabled,
    id,
    mode,
    onChange,
    toolbar,
    value,
  }: MarkdownPaneProps & { toolbar?: ReactNode }) {
    if (mode === "read") {
      return <div>{value}</div>;
    }

    return (
      <div aria-label="Mock markdown pane">
        {toolbar}
        <textarea
          aria-label="Markdown source"
          disabled={disabled}
          id={id}
          onChange={(event) => onChange?.(event.target.value)}
          value={value}
        />
      </div>
    );
  },
}));

vi.mock("./MarkdownPreview", () => ({
  MarkdownPreview({ source, toolbar }: { source: string; toolbar?: ReactNode }) {
    return (
      <div aria-label="Markdown preview">
        {toolbar}
        {source}
      </div>
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
  needs_ai_organization: false,
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
    toolbarControls: null,
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
    expect(screen.getByRole("toolbar", { name: "Note toolbar" })).toHaveTextContent("12 chars");
    expect(screen.getByRole("toolbar", { name: "Note toolbar" })).toHaveTextContent("Work");
    expect(screen.getByRole("toolbar", { name: "Note toolbar" })).toContainElement(
      screen.getByLabelText("Save changes"),
    );
    expect(screen.getByLabelText("Mock markdown pane")).toContainElement(
      screen.getByRole("toolbar", { name: "Note toolbar" }),
    );

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

    fireEvent.click(screen.getByLabelText("Save changes"));
    await waitFor(() => {
      expect(onSaveEdit).toHaveBeenCalledWith({
        original_text: "Unsaved body",
        ai_title: "AI title",
        short_summary: "AI summary.",
        tags: ["ai", "draft"],
        category_id: 1,
        ai_organization_completed: true,
      });
    });
  });

  test.each([false, true])("shows the tidying marker in edit and read modes", (readMode) => {
    renderDetail({ note: { ...note, needs_ai_organization: true }, readMode });

    const marker = screen.getByText("Needs a little tidying");
    expect(marker).toBeInTheDocument();
    expect(marker.closest("span")).toHaveAttribute(
      "title",
      "Use Regenerate details, then Save changes.",
    );
  });

  test("ordinary saves do not claim AI organization completed", () => {
    const onSaveEdit = vi.fn().mockResolvedValue(undefined);
    renderDetail({ note: { ...note, needs_ai_organization: true }, onSaveEdit });

    fireEvent.click(screen.getByLabelText("Save changes"));

    expect(onSaveEdit).toHaveBeenCalledWith({
      original_text: "Initial body",
      ai_title: "Initial title",
      short_summary: "Initial summary",
      tags: ["alpha", "beta"],
      category_id: 1,
    });
  });

  test("failed regeneration leaves later saves ordinary", async () => {
    const onRegenerateDetails = vi.fn().mockRejectedValue(new Error("Organizer unavailable"));
    const onSaveEdit = vi.fn().mockResolvedValue(undefined);
    renderDetail({
      note: { ...note, needs_ai_organization: true },
      onRegenerateDetails,
      onSaveEdit,
    });

    fireEvent.click(screen.getByLabelText("Regenerate details"));
    await screen.findByText("Organizer unavailable");
    fireEvent.click(screen.getByLabelText("Save changes"));

    expect(onSaveEdit).toHaveBeenCalledWith(expect.not.objectContaining({ ai_organization_completed: true }));
  });

  test("hides edit actions in read mode while showing the full markdown document", () => {
    renderDetail({ readMode: true });

    expect(screen.queryByLabelText("Regenerate details")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Save changes")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Cancel edit")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New note")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete note")).not.toBeInTheDocument();
    expect(screen.queryByText("Details")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Markdown preview")).toContainElement(
      screen.getByRole("toolbar", { name: "Note toolbar" }),
    );
    expect(screen.getByLabelText("Markdown preview")).toHaveTextContent("title: Initial title");
    expect(screen.getByLabelText("Markdown preview")).toHaveTextContent("summary: Initial summary");
    expect(screen.getByLabelText("Markdown preview")).toHaveTextContent("tags: alpha, beta");
    expect(screen.getByLabelText("Markdown preview")).toHaveTextContent("category: Work");
    expect(screen.getByLabelText("Markdown preview")).toHaveTextContent("Initial body");
  });
});
