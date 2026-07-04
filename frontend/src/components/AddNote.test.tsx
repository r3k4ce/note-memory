import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AddNote } from "./AddNote";
import type { MarkdownPaneHandle, MarkdownPaneProps } from "./MarkdownPane";

vi.mock("./MarkdownPane", () => ({
  MarkdownPane({ disabled, onChange, placeholder, value }: MarkdownPaneProps) {
    return (
      <textarea
        aria-label="Markdown source"
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    );
  },
}));

afterEach(() => {
  cleanup();
});

function renderAddNote({ isSaving = false }: { isSaving?: boolean } = {}) {
  return render(
    <AddNote
      captureRef={createRef<MarkdownPaneHandle>()}
      categories={[]}
      draftText=""
      error={null}
      isSaving={isSaving}
      onCategoryChange={vi.fn()}
      onDraftTextChange={vi.fn()}
      onSave={vi.fn()}
      selectedCategoryId={null}
    />,
  );
}

describe("AddNote copy", () => {
  test("frames the note editor as a new note save flow", () => {
    renderAddNote();

    expect(screen.getByRole("heading", { name: "New note" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save note" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Write in Markdown... AI will organize it with a title, summary, and tags after save.")).toBeInTheDocument();
  });

  test("uses saving copy while the note is being saved", () => {
    renderAddNote({ isSaving: true });

    expect(screen.getByRole("button", { name: "Saving..." })).toBeInTheDocument();
  });
});
