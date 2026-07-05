import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
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
      extensions: [markdown({ base: markdownLanguage }), markdownLivePreviewExtension],
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

function taskCheckboxes(editor: EditorView) {
  return Array.from(editor.dom.querySelectorAll<HTMLElement>(".cm-md-task-checkbox"));
}

function listMarkers(editor: EditorView) {
  return Array.from(editor.dom.querySelectorAll<HTMLElement>(".cm-md-list-marker"));
}

function horizontalRules(editor: EditorView) {
  return Array.from(editor.dom.querySelectorAll<HTMLElement>(".cm-md-horizontal-rule"));
}

function imagePlaceholders(editor: EditorView) {
  return Array.from(editor.dom.querySelectorAll<HTMLElement>(".cm-md-image-placeholder"));
}

function tableWidgets(editor: EditorView) {
  return Array.from(editor.dom.querySelectorAll<HTMLElement>(".cm-md-table"));
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

  test("conceals inactive combined strong emphasis delimiters without changing the document", () => {
    const doc = "This is ***bold and italic*** text\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    const line = lineWithText(editor, "This is bold and italic text");
    expect(line).toBeInTheDocument();
    expect(line?.querySelector(".cm-md-strong")).toHaveTextContent("bold and italic");
    expect(line?.querySelector(".cm-md-emphasis")).toHaveTextContent("bold and italic");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("conceals inactive strikethrough delimiters without changing the document", () => {
    const doc = "This has ~~strikethrough~~ text\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    const line = lineWithText(editor, "This has strikethrough text");
    expect(line).toBeInTheDocument();
    expect(line?.querySelector(".cm-md-strikethrough")).toHaveTextContent("strikethrough");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("reveals strikethrough delimiters when the line is active", () => {
    const editor = createEditor("This has ~~strikethrough~~ text\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(12),
    });

    expect(lineWithText(editor, "This has ~~strikethrough~~ text")).toBeInTheDocument();
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
    const doc = "[ref][id]\n\n<https://example.com>\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "[ref][id]")).toBeInTheDocument();
    expect(lineWithText(editor, "<https://example.com>")).toBeInTheDocument();
    expect(editor.dom.querySelector(".cm-md-link")).not.toBeInTheDocument();
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("replaces inactive image syntax with a placeholder without changing the document", () => {
    const doc = "![Example image alt text](https://via.placeholder.com/600x300)\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "![Example image alt text](https://via.placeholder.com/600x300)")).toBeUndefined();
    expect(imagePlaceholders(editor)).toHaveLength(1);
    expect(imagePlaceholders(editor)[0]).toHaveTextContent("Example image alt text");
    expect(imagePlaceholders(editor)[0].querySelector("img")).not.toBeInTheDocument();
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("reveals image syntax when the image line is active", () => {
    const doc = "![Example image alt text](https://via.placeholder.com/600x300)\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(4),
    });

    expect(lineWithText(editor, "![Example image alt text](https://via.placeholder.com/600x300)")).toBeInTheDocument();
    expect(imagePlaceholders(editor)).toHaveLength(0);
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

  test("keeps fenced code markers concealed when the cursor is inside the code body", () => {
    const editor = createEditor('```python\nimport random\n\nprint("hello, world!")\n```\n\nplain');

    editor.dispatch({
      selection: EditorSelection.cursor(17),
    });

    expect(lineWithText(editor, "```python")).toBeUndefined();
    expect(lineWithText(editor, "```")).toBeUndefined();
    expect(lineWithText(editor, "import random")).toHaveClass("cm-md-fenced-code-line", "cm-md-fenced-code-first-line");
    expect(fencedCodeLanguageLabels(editor)).toHaveLength(1);
  });

  test("reveals the opening fenced code marker when its line is active", () => {
    const editor = createEditor('```python\nimport random\n\nprint("hello, world!")\n```\n\nplain');

    editor.dispatch({
      selection: EditorSelection.cursor(3),
    });

    expect(lineWithText(editor, "```python")).toBeInTheDocument();
    expect(lineWithText(editor, "```")).toBeUndefined();
    expect(fencedCodeLanguageLabels(editor)).toHaveLength(0);
  });

  test("reveals the closing fenced code marker when its line is active", () => {
    const editor = createEditor('```python\nimport random\n\nprint("hello, world!")\n```\n\nplain');

    editor.dispatch({
      selection: EditorSelection.cursor(51),
    });

    expect(lineWithText(editor, "```python")).toBeUndefined();
    expect(lineWithText(editor, "```")).toBeInTheDocument();
    expect(fencedCodeLanguageLabels(editor)).toHaveLength(1);
  });

  test("reveals only fenced code marker lines overlapped by a selection", () => {
    const editor = createEditor('```python\nimport random\n\nprint("hello, world!")\n```\n\nplain');

    editor.dispatch({
      selection: EditorSelection.range(5, 20),
    });

    expect(lineWithText(editor, "```python")).toBeInTheDocument();
    expect(lineWithText(editor, "```")).toBeUndefined();
    expect(fencedCodeLanguageLabels(editor)).toHaveLength(0);
  });

  test("replaces inactive unchecked task markers with a visual checkbox without changing the document", () => {
    const doc = "- [ ] task\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    const line = lineWithText(editor, " task");
    expect(line).toBeInTheDocument();
    expect(taskCheckboxes(editor)).toHaveLength(1);
    expect(taskCheckboxes(editor)[0]).toHaveClass("cm-md-task-checkbox-unchecked");
    expect(taskCheckboxes(editor)[0]).not.toHaveClass("cm-md-task-checkbox-checked");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("replaces inactive checked task markers with a visual checkbox without changing the document", () => {
    const doc = "- [x] done\n- [X] also done\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    const checkboxes = taskCheckboxes(editor);
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]).toHaveClass("cm-md-task-checkbox-checked");
    expect(checkboxes[1]).toHaveClass("cm-md-task-checkbox-checked");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("clicking a task checkbox visual does not change the document", () => {
    const doc = "- [ ] task\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    taskCheckboxes(editor)[0].click();

    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("reveals task markers when the task line is active", () => {
    const editor = createEditor("- [ ] task\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(3),
    });

    expect(lineWithText(editor, "- [ ] task")).toBeInTheDocument();
    expect(taskCheckboxes(editor)).toHaveLength(0);
  });

  test("reveals task markers when a selection overlaps the task line", () => {
    const editor = createEditor("- [x] task\n\nplain");

    editor.dispatch({
      selection: EditorSelection.range(0, 10),
    });

    expect(lineWithText(editor, "- [x] task")).toBeInTheDocument();
    expect(taskCheckboxes(editor)).toHaveLength(0);
  });

  test("does not replace bracket text that is not a task marker", () => {
    const doc = "- [x]task\n- [ ]\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "- [x]task")).toBeInTheDocument();
    expect(taskCheckboxes(editor)).toHaveLength(1);
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("replaces inactive unordered and ordered list markers with visual markers", () => {
    const doc = "- Apples\n  - Blood orange\n\n1. First step\n2. Second step\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(listMarkers(editor)).toHaveLength(4);
    expect(listMarkers(editor)[0]).toHaveTextContent("•");
    expect(listMarkers(editor)[1]).toHaveTextContent("•");
    expect(listMarkers(editor)[2]).toHaveTextContent("1.");
    expect(listMarkers(editor)[3]).toHaveTextContent("2.");
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("reveals list markers when the list line is active", () => {
    const editor = createEditor("- Apples\n\nplain");

    editor.dispatch({
      selection: EditorSelection.cursor(2),
    });

    expect(lineWithText(editor, "- Apples")).toBeInTheDocument();
    expect(listMarkers(editor)).toHaveLength(0);
  });

  test("replaces inactive horizontal rules with a visual separator", () => {
    const doc = "Before\n\n---\n\nAfter";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "---")).toBeUndefined();
    expect(horizontalRules(editor)).toHaveLength(1);
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("reveals horizontal rules when the rule line is active", () => {
    const editor = createEditor("Before\n\n---\n\nAfter");

    editor.dispatch({
      selection: EditorSelection.cursor(9),
    });

    expect(lineWithText(editor, "---")).toBeInTheDocument();
    expect(horizontalRules(editor)).toHaveLength(0);
  });

  test("replaces inactive tables with a rendered table widget", () => {
    const doc = "| Name | Role | Status |\n|---|---|---|\n| Adrian | Mapping Analyst | Active |\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(tableWidgets(editor)).toHaveLength(1);
    expect(tableWidgets(editor)[0].querySelectorAll("thead th")).toHaveLength(3);
    expect(tableWidgets(editor)[0]).toHaveTextContent("Name");
    expect(tableWidgets(editor)[0]).toHaveTextContent("Adrian");
    expect(lineWithText(editor, "|---|---|---|")).toBeUndefined();
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("reveals the whole raw table when a table line is active", () => {
    const doc = "| Name | Role | Status |\n|---|---|---|\n| Adrian | Mapping Analyst | Active |\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(28),
    });

    expect(tableWidgets(editor)).toHaveLength(0);
    expect(lineWithText(editor, "| Name | Role | Status |")).toBeInTheDocument();
    expect(lineWithText(editor, "|---|---|---|")).toBeInTheDocument();
    expect(lineWithText(editor, "| Adrian | Mapping Analyst | Active |")).toBeInTheDocument();
  });

  test("conceals simple inactive footnote references and definitions", () => {
    const doc = "Here is a sentence with a footnote.[^1]\n\n[^1]: This is the footnote text.\n\nplain";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "Here is a sentence with a footnote.1")).toBeInTheDocument();
    expect(lineWithText(editor, "1 This is the footnote text.")).toBeInTheDocument();
    expect(editor.dom.querySelectorAll(".cm-md-footnote-ref")).toHaveLength(1);
    expect(editor.dom.querySelectorAll(".cm-md-footnote-definition")).toHaveLength(1);
    expect(editor.state.doc.toString()).toBe(doc);
  });

  test("keeps raw HTML blocks visible in edit-mode live preview", () => {
    const doc = "<details>\n<summary>Click to expand</summary>\n\nText\n\n</details>";
    const editor = createEditor(doc);

    editor.dispatch({
      selection: EditorSelection.cursor(editor.state.doc.length),
    });

    expect(lineWithText(editor, "<details>")).toBeInTheDocument();
    expect(lineWithText(editor, "<summary>Click to expand</summary>")).toBeInTheDocument();
    expect(lineWithText(editor, "</details>")).toBeInTheDocument();
  });
});
