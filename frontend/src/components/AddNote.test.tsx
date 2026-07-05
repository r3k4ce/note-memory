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

vi.mock("./MarkdownPreview", () => ({
  MarkdownPreview({ source }: { source: string }) {
    return <div aria-label="Markdown preview">{source}</div>;
  },
}));

afterEach(() => {
  cleanup();
});

function renderAddNote({
  draftText = "",
  isSaving = false,
  readMode = false,
}: {
  draftText?: string;
  isSaving?: boolean;
  readMode?: boolean;
} = {}) {
  return render(
    <AddNote
      captureRef={createRef<MarkdownPaneHandle>()}
      categories={[]}
      draftText={draftText}
      error={null}
      isSaving={isSaving}
      onDraftTextChange={vi.fn()}
      onSave={vi.fn()}
      readMode={readMode}
      toolbarControls={null}
    />,
  );
}

describe("AddNote copy", () => {
  test("frames the note editor as a new note save flow", () => {
    renderAddNote();

    expect(screen.getByRole("heading", { name: "New note" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Note toolbar" })).toHaveTextContent(
      "Alt+1 to focus",
    );
    expect(screen.getByRole("toolbar", { name: "Note toolbar" })).toContainElement(
      screen.getByRole("button", { name: "Save note" }),
    );
    expect(screen.getByPlaceholderText("Write in Markdown...")).toBeInTheDocument();
  });

  test("uses saving copy while the note is being saved", () => {
    renderAddNote({ isSaving: true });

    expect(screen.getByRole("button", { name: "Saving..." })).toBeInTheDocument();
  });

  test("previews the unsaved draft in read mode", () => {
    renderAddNote({
      draftText: ["---", "title: Draft title", "---", "", "# Draft title"].join("\n"),
      readMode: true,
    });

    expect(screen.queryByRole("button", { name: "Save note" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Markdown source")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Markdown preview")).toHaveTextContent("# Draft title");
    expect(screen.getByLabelText("Markdown preview")).not.toHaveTextContent("title: Draft title");
  });
});
