import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { afterEach, describe, expect, test } from "vitest";

import { markdownLivePreviewExtension } from "./markdownLivePreview";

let view: EditorView | undefined;

afterEach(() => {
  view?.destroy();
  view = undefined;
  document.body.replaceChildren();
});

function createEditor(doc: string) {
  const parent = document.createElement("div");
  document.body.append(parent);

  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdown(), markdownLivePreviewExtension],
    }),
  });

  return view;
}

function lineWithText(editor: EditorView, text: string) {
  return Array.from(editor.dom.querySelectorAll<HTMLElement>(".cm-line")).find((line) => line.textContent === text);
}

describe("markdownLivePreviewExtension", () => {
  test("conceals inactive ATX heading markers without changing the document", () => {
    const editor = createEditor("# One\n\n## Two\n\n### Three\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "One")).toHaveClass("cm-md-heading-line", "cm-md-heading-1");
    expect(lineWithText(editor, "Two")).toHaveClass("cm-md-heading-line", "cm-md-heading-2");
    expect(lineWithText(editor, "Three")).toHaveClass("cm-md-heading-line", "cm-md-heading-3");
    expect(lineWithText(editor, "plain")).not.toHaveClass("cm-md-heading-line");
    expect(editor.state.doc.toString()).toBe("# One\n\n## Two\n\n### Three\n\nplain");
  });

  test("reveals ATX heading markers when the heading line is active", () => {
    const editor = createEditor("# One\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(2),
    });

    expect(lineWithText(editor, "# One")).toHaveClass("cm-md-heading-line", "cm-md-heading-1");
    expect(lineWithText(editor, "plain")).not.toHaveClass("cm-md-heading-line");
  });

  test("reveals ATX heading markers when a selection overlaps the heading line", () => {
    const editor = createEditor("# One\n\nplain");

    editor.dispatch({
      selection: EditorSelection.range(0, 5),
    });

    expect(lineWithText(editor, "# One")).toHaveClass("cm-md-heading-line", "cm-md-heading-1");
  });

  test("does not conceal text that is not parsed as an ATX heading", () => {
    const editor = createEditor("###NoSpace\n\nplain");

    expect(lineWithText(editor, "###NoSpace")).not.toHaveClass("cm-md-heading-line");
    expect(editor.state.doc.toString()).toBe("###NoSpace\n\nplain");
  });

  test("styles only the title line for Setext headings", () => {
    const editor = createEditor("One\n===\n\nTwo\n---\n\nplain");

    expect(lineWithText(editor, "One")).toHaveClass("cm-md-heading-line", "cm-md-heading-1");
    expect(lineWithText(editor, "===")).not.toHaveClass("cm-md-heading-line");
    expect(lineWithText(editor, "Two")).toHaveClass("cm-md-heading-line", "cm-md-heading-2");
    expect(lineWithText(editor, "---")).not.toHaveClass("cm-md-heading-line");
    expect(lineWithText(editor, "plain")).not.toHaveClass("cm-md-heading-line");
  });
});
