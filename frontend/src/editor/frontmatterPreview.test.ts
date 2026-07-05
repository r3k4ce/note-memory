import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test } from "vitest";

import { frontmatterPreviewExtension } from "./frontmatterPreview";

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
      extensions: [frontmatterPreviewExtension],
    }),
  });

  return view;
}

describe("frontmatterPreviewExtension", () => {
  test("collapses inactive top frontmatter without changing the document", () => {
    const doc = ["---", "title: Example", "summary: Hidden", "---", "", "Body"].join("\n");
    const editor = createEditor(doc);

    editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });

    expect(editor.dom.querySelector(".cm-note-frontmatter-widget")).toHaveTextContent("Note details");
    expect(editor.dom).not.toHaveTextContent("title: Example");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("reveals frontmatter when the cursor is inside it", () => {
    const editor = createEditor(["---", "title: Example", "---", "", "Body"].join("\n"));

    editor.dispatch({ selection: EditorSelection.cursor(5) });

    expect(editor.dom.querySelector(".cm-note-frontmatter-widget")).not.toBeInTheDocument();
    expect(editor.dom).toHaveTextContent("title: Example");
  });
});
