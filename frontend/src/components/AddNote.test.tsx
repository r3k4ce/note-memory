import { cleanup, render, screen } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AddNote } from "./AddNote";
import type { MarkdownPaneHandle, MarkdownPaneProps } from "./MarkdownPane";

vi.mock("./MarkdownPane", () => ({
  MarkdownPane({
    disabled,
    onChange,
    placeholder,
    toolbar,
    value,
  }: MarkdownPaneProps & { toolbar?: ReactNode }) {
    return (
      <div aria-label="Mock markdown pane">
        {toolbar}
        <textarea
          aria-label="Markdown source"
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value)}
          placeholder={placeholder}
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
    expect(screen.getByLabelText("Mock markdown pane")).toContainElement(
      screen.getByRole("toolbar", { name: "Note toolbar" }),
    );
    expect(screen.getByPlaceholderText("Start writing your note in Markdown…")).toBeInTheDocument();
  });

  test("uses saving copy while the note is being saved", () => {
    renderAddNote({ isSaving: true });

    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
  });

  test("previews the unsaved draft in read mode", () => {
    renderAddNote({
      draftText: ["---", "title: Draft title", "---", "", "# Draft title"].join("\n"),
      readMode: true,
    });

    expect(screen.queryByRole("button", { name: "Save note" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Markdown source")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Markdown preview")).toContainElement(
      screen.getByRole("toolbar", { name: "Note toolbar" }),
    );
    expect(screen.getByLabelText("Markdown preview")).toHaveTextContent("# Draft title");
    expect(screen.getByLabelText("Markdown preview")).toHaveTextContent("title: Draft title");
  });
});
