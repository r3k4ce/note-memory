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

function linesWithText(editor: EditorView, text: string) {
  return Array.from(editor.dom.querySelectorAll<HTMLElement>(".cm-line")).filter((line) => line.textContent === text);
}

function fencedCodeLanguageLabels(editor: EditorView) {
  return Array.from(editor.dom.querySelectorAll<HTMLElement>(".cm-md-fenced-code-language"));
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

  test("conceals inactive blockquote markers without changing the document", () => {
    const editor = createEditor("> quote\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "quote")).toHaveClass("cm-md-blockquote-line");
    expect(lineWithText(editor, "plain")).not.toHaveClass("cm-md-blockquote-line");
    expect(editor.state.doc.toString()).toBe("> quote\n\nplain");
  });

  test("reveals blockquote markers when the blockquote line is active", () => {
    const editor = createEditor("> quote\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(3),
    });

    expect(lineWithText(editor, "> quote")).toHaveClass("cm-md-blockquote-line");
  });

  test("reveals blockquote markers when a selection overlaps the blockquote line", () => {
    const editor = createEditor("> quote\n\nplain");

    editor.dispatch({
      selection: EditorSelection.range(0, 7),
    });

    expect(lineWithText(editor, "> quote")).toHaveClass("cm-md-blockquote-line");
  });

  test("conceals inactive inline code delimiters without changing the document", () => {
    const editor = createEditor("Use `code` here\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    const codeLine = lineWithText(editor, "Use code here");
    expect(codeLine).toBeInTheDocument();
    expect(codeLine?.querySelector(".cm-md-inline-code")).toHaveTextContent("code");
    expect(editor.state.doc.toString()).toBe("Use `code` here\n\nplain");
  });

  test("reveals inline code delimiters when the line is active", () => {
    const editor = createEditor("Use `code` here\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(6),
    });

    expect(lineWithText(editor, "Use `code` here")).toBeInTheDocument();
  });

  test("reveals inline code delimiters when a selection overlaps the line", () => {
    const editor = createEditor("Use `code` here\n\nplain");

    editor.dispatch({
      selection: EditorSelection.range(0, 14),
    });

    expect(lineWithText(editor, "Use `code` here")).toBeInTheDocument();
  });

  test("conceals inactive strong emphasis delimiters without changing the document", () => {
    const doc = "This is **bold** and __strong__\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    const line = lineWithText(editor, "This is bold and strong");
    expect(line).toBeInTheDocument();
    expect(line?.querySelectorAll(".cm-md-strong")).toHaveLength(2);
    expect(line?.querySelectorAll(".cm-md-strong")[0]).toHaveTextContent("bold");
    expect(line?.querySelectorAll(".cm-md-strong")[1]).toHaveTextContent("strong");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("conceals inactive emphasis delimiters without changing the document", () => {
    const doc = "This is *italic* and _emphasis_\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    const line = lineWithText(editor, "This is italic and emphasis");
    expect(line).toBeInTheDocument();
    expect(line?.querySelectorAll(".cm-md-emphasis")).toHaveLength(2);
    expect(line?.querySelectorAll(".cm-md-emphasis")[0]).toHaveTextContent("italic");
    expect(line?.querySelectorAll(".cm-md-emphasis")[1]).toHaveTextContent("emphasis");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("reveals emphasis and strong emphasis delimiters when the line is active", () => {
    const editor = createEditor("This is *italic* and **bold**\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(10),
    });

    expect(lineWithText(editor, "This is *italic* and **bold**")).toBeInTheDocument();
  });

  test("reveals emphasis and strong emphasis delimiters when a selection overlaps the line", () => {
    const editor = createEditor("This is *italic* and **bold**\n\nplain");

    editor.dispatch({
      selection: EditorSelection.range(0, 29),
    });

    expect(lineWithText(editor, "This is *italic* and **bold**")).toBeInTheDocument();
  });

  test("conceals inactive inline link syntax without changing the document", () => {
    const doc = "Open [docs](https://example.com) here\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    const line = lineWithText(editor, "Open docs here");
    expect(line).toBeInTheDocument();
    expect(line?.querySelector(".cm-md-link")).toHaveTextContent("docs");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("conceals inactive inline link titles with the URL syntax", () => {
    const doc = 'Open [docs](https://example.com "Docs") here\n\nplain';
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    const line = lineWithText(editor, "Open docs here");
    expect(line).toBeInTheDocument();
    expect(line?.querySelector(".cm-md-link")).toHaveTextContent("docs");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("reveals inline link syntax when the line is active", () => {
    const editor = createEditor("Open [docs](https://example.com) here\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(8),
    });

    expect(lineWithText(editor, "Open [docs](https://example.com) here")).toBeInTheDocument();
  });

  test("reveals inline link syntax when a selection overlaps the line", () => {
    const editor = createEditor("Open [docs](https://example.com) here\n\nplain");

    editor.dispatch({
      selection: EditorSelection.range(0, 32),
    });

    expect(lineWithText(editor, "Open [docs](https://example.com) here")).toBeInTheDocument();
  });

  test("does not conceal images, reference links, or autolinks", () => {
    const doc = "![alt](image.png)\n\n[ref][id]\n\n<https://example.com>\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "![alt](image.png)")).toBeInTheDocument();
    expect(lineWithText(editor, "[ref][id]")).toBeInTheDocument();
    expect(lineWithText(editor, "<https://example.com>")).toBeInTheDocument();
    expect(editor.dom.querySelector(".cm-md-link")).not.toBeInTheDocument();
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("does not conceal backticks inside fenced code blocks", () => {
    const editor = createEditor("```\n`not inline`\n```\n\nUse `code` here\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "`not inline`")).toBeInTheDocument();
    expect(lineWithText(editor, "Use code here")).toBeInTheDocument();
    expect(editor.state.doc.toString()).toBe("```\n`not inline`\n```\n\nUse `code` here\n\nplain");
  });

  test("conceals inactive fenced code markers and styles the code body", () => {
    const doc = '```python\nimport random\n\nprint("hello, world!")\n```\n\nplain';
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "```python")).toBeUndefined();
    expect(lineWithText(editor, "```")).toBeUndefined();
    expect(lineWithText(editor, "import random")).toHaveClass("cm-md-fenced-code-line", "cm-md-fenced-code-first-line");
    expect(lineWithText(editor, 'print("hello, world!")')).toHaveClass(
      "cm-md-fenced-code-line",
      "cm-md-fenced-code-last-line",
    );
    expect(linesWithText(editor, "")).toEqual(
      expect.arrayContaining([expect.objectContaining({ className: expect.stringContaining("cm-md-fenced-code-line") })]),
    );
    expect(fencedCodeLanguageLabels(editor)).toHaveLength(1);
    expect(fencedCodeLanguageLabels(editor)[0]).toHaveTextContent("python");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("shows only the first fenced code info token as the language label", () => {
    const editor = createEditor("```js title=demo\nconsole.log(1)\n```\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(fencedCodeLanguageLabels(editor)).toHaveLength(1);
    expect(fencedCodeLanguageLabels(editor)[0]).toHaveTextContent("js");
    expect(fencedCodeLanguageLabels(editor)[0]).not.toHaveTextContent("title=demo");
  });

  test("does not show a fenced code language label without an info string", () => {
    const editor = createEditor("```\nplain\n```\n\ntext");

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(fencedCodeLanguageLabels(editor)).toHaveLength(0);
  });

  test("reveals fenced code markers when the cursor is inside the code block", () => {
    const editor = createEditor('```python\nimport random\n\nprint("hello, world!")\n```\n\nplain');

    editor.dispatch({
      selection: EditorSelection.cursor(17),
    });

    expect(lineWithText(editor, "```python")).toBeInTheDocument();
    expect(lineWithText(editor, "```")).toBeInTheDocument();
    expect(fencedCodeLanguageLabels(editor)).toHaveLength(0);
  });

  test("reveals fenced code markers when a selection overlaps the code block", () => {
    const editor = createEditor('```python\nimport random\n\nprint("hello, world!")\n```\n\nplain');

    editor.dispatch({
      selection: EditorSelection.range(5, 20),
    });

    expect(lineWithText(editor, "```python")).toBeInTheDocument();
    expect(lineWithText(editor, "```")).toBeInTheDocument();
  });
});
