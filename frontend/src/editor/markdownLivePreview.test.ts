import { EditorState } from "@codemirror/state";
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
  test("adds heading classes to ATX heading lines without affecting plain lines", () => {
    const editor = createEditor("# One\n\n### Three\n\nplain");

    expect(lineWithText(editor, "# One")).toHaveClass("cm-md-heading-line", "cm-md-heading-1");
    expect(lineWithText(editor, "### Three")).toHaveClass("cm-md-heading-line", "cm-md-heading-3");
    expect(lineWithText(editor, "plain")).not.toHaveClass("cm-md-heading-line");
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
