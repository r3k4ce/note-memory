import { syntaxTree } from "@codemirror/language";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

const atxHeadingLevels = new Map([
  ["ATXHeading1", 1],
  ["ATXHeading2", 2],
  ["ATXHeading3", 3],
  ["ATXHeading4", 4],
  ["ATXHeading5", 5],
  ["ATXHeading6", 6],
]);

const setextHeadingLevels = new Map([
  ["SetextHeading1", 1],
  ["SetextHeading2", 2],
]);

type SyntaxRange = {
  from: number;
  to: number;
};

type InlineCodeNode = SyntaxRange & {
  node: {
    getChildren: (type: string) => SyntaxRange[];
  };
};

type FormattedTextNode = SyntaxRange & {
  node: {
    getChildren: (type: string) => SyntaxRange[];
  };
};

type LinkNode = SyntaxRange & {
  node: {
    getChild: (type: string) => SyntaxRange | null;
    getChildren: (type: string) => SyntaxRange[];
  };
};

type ImageNode = SyntaxRange & {
  node: {
    getChildren: (type: string) => SyntaxRange[];
  };
};

type FencedCodeNode = SyntaxRange & {
  node: {
    getChild: (type: string) => SyntaxRange | null;
    getChildren: (type: string) => SyntaxRange[];
  };
};

type TableNode = SyntaxRange;

type DecorationRange = ReturnType<Decoration["range"]>;

class TaskCheckboxWidget extends WidgetType {
  constructor(private readonly checked: boolean) {
    super();
  }

  eq(widget: WidgetType) {
    return widget instanceof TaskCheckboxWidget && widget.checked === this.checked;
  }

  toDOM() {
    const checkbox = document.createElement("span");
    checkbox.className = `cm-md-task-checkbox cm-md-task-checkbox-${this.checked ? "checked" : "unchecked"}`;
    checkbox.setAttribute("aria-hidden", "true");
    return checkbox;
  }
}

class FencedCodeLanguageWidget extends WidgetType {
  constructor(private readonly language: string) {
    super();
  }

  eq(widget: WidgetType) {
    return widget instanceof FencedCodeLanguageWidget && widget.language === this.language;
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-fenced-code-language-row";

    const label = document.createElement("span");
    label.className = "cm-md-fenced-code-language";
    label.textContent = this.language;
    wrapper.append(label);

    return wrapper;
  }
}

class ListMarkerWidget extends WidgetType {
  constructor(private readonly marker: string) {
    super();
  }

  eq(widget: WidgetType) {
    return widget instanceof ListMarkerWidget && widget.marker === this.marker;
  }

  toDOM() {
    const marker = document.createElement("span");
    marker.className = "cm-md-list-marker";
    marker.setAttribute("aria-hidden", "true");
    marker.textContent = this.marker;
    return marker;
  }
}

class HorizontalRuleWidget extends WidgetType {
  eq(widget: WidgetType) {
    return widget instanceof HorizontalRuleWidget;
  }

  toDOM() {
    const rule = document.createElement("span");
    rule.className = "cm-md-horizontal-rule";
    rule.setAttribute("aria-hidden", "true");
    return rule;
  }
}

class ImagePlaceholderWidget extends WidgetType {
  constructor(private readonly altText: string) {
    super();
  }

  eq(widget: WidgetType) {
    return widget instanceof ImagePlaceholderWidget && widget.altText === this.altText;
  }

  toDOM() {
    const placeholder = document.createElement("span");
    placeholder.className = "cm-md-image-placeholder";

    const icon = document.createElement("span");
    icon.className = "cm-md-image-placeholder-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "IMG";
    placeholder.append(icon);

    const label = document.createElement("span");
    label.className = "cm-md-image-placeholder-label";
    label.textContent = this.altText || "Image";
    placeholder.append(label);

    return placeholder;
  }
}

class FootnoteReferenceWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  eq(widget: WidgetType) {
    return widget instanceof FootnoteReferenceWidget && widget.label === this.label;
  }

  toDOM() {
    const reference = document.createElement("sup");
    reference.className = "cm-md-footnote-ref";
    reference.textContent = this.label;
    return reference;
  }
}

class FootnoteDefinitionWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }

  eq(widget: WidgetType) {
    return widget instanceof FootnoteDefinitionWidget && widget.label === this.label;
  }

  toDOM() {
    const definition = document.createElement("span");
    definition.className = "cm-md-footnote-definition";
    definition.textContent = `${this.label} `;
    return definition;
  }
}

class MarkdownTableWidget extends WidgetType {
  constructor(private readonly table: MarkdownTable) {
    super();
  }

  eq(widget: WidgetType) {
    return widget instanceof MarkdownTableWidget && JSON.stringify(widget.table) === JSON.stringify(this.table);
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-md-table";

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    this.table.header.forEach((cell) => {
      const th = document.createElement("th");
      th.textContent = cell;
      headerRow.append(th);
    });
    thead.append(headerRow);
    table.append(thead);

    const tbody = document.createElement("tbody");
    this.table.rows.forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((cell) => {
        const td = document.createElement("td");
        td.textContent = cell;
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody);
    wrapper.append(table);

    return wrapper;
  }
}

type MarkdownTable = {
  header: string[];
  rows: string[][];
};

function headingLineClass(level: number) {
  return `cm-md-heading-line cm-md-heading-${level}`;
}

function selectionOverlapsRange(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some((range) => {
    if (range.empty) {
      return from <= range.head && range.head <= to;
    }

    return range.from <= to && range.to >= from;
  });
}

function lineOverlapsSelection(view: EditorView, line: SyntaxRange) {
  return selectionOverlapsRange(view, line.from, line.to);
}

function atxMarkerEnd(view: EditorView, markerStart: number, lineTo: number) {
  let markerEnd = markerStart;

  while (markerEnd < lineTo && view.state.sliceDoc(markerEnd, markerEnd + 1) === "#") {
    markerEnd += 1;
  }

  while (markerEnd < lineTo) {
    const character = view.state.sliceDoc(markerEnd, markerEnd + 1);
    if (character !== " " && character !== "\t") {
      break;
    }
    markerEnd += 1;
  }

  return markerEnd;
}

function blockquoteMarkerEnd(view: EditorView, markerStart: number, lineTo: number) {
  let markerEnd = markerStart + 1;

  if (markerEnd < lineTo) {
    const character = view.state.sliceDoc(markerEnd, markerEnd + 1);
    if (character === " " || character === "\t") {
      markerEnd += 1;
    }
  }

  return markerEnd;
}

function inactiveLine(view: EditorView, position: number) {
  const line = view.state.doc.lineAt(position);
  return lineOverlapsSelection(view, line) ? null : line;
}

function addInactiveInlineCodeDecorations(
  view: EditorView,
  inlineCodeNode: InlineCodeNode,
  decorations: DecorationRange[],
) {
  const line = view.state.doc.lineAt(inlineCodeNode.from);
  if (lineOverlapsSelection(view, line)) {
    return;
  }

  const codeMarks = inlineCodeNode.node.getChildren("CodeMark");
  if (codeMarks.length < 2) {
    return;
  }

  const openingMark = codeMarks[0];
  const closingMark = codeMarks[codeMarks.length - 1];
  addDelimitedConcealmentDecorations(
    decorations,
    openingMark,
    openingMark.to,
    closingMark.from,
    closingMark,
    "cm-md-inline-code",
  );
}

function addInactiveFormattedTextDecorations(
  view: EditorView,
  formattedTextNode: FormattedTextNode,
  decorations: DecorationRange[],
  className: string,
  markerLength: number,
) {
  const line = view.state.doc.lineAt(formattedTextNode.from);
  if (
    line.to < formattedTextNode.to ||
    lineOverlapsSelection(view, line) ||
    formattedTextNode.node.getChildren("Emphasis").length > 1 ||
    formattedTextNode.node.getChildren("StrongEmphasis").length > 1
  ) {
    return;
  }

  const emphasisMarks = formattedTextNode.node.getChildren("EmphasisMark");
  if (emphasisMarks.length !== 2) {
    return;
  }

  const openingMark = emphasisMarks[0];
  const closingMark = emphasisMarks[1];
  if (openingMark.to - openingMark.from !== markerLength || closingMark.to - closingMark.from !== markerLength) {
    return;
  }

  addDelimitedConcealmentDecorations(
    decorations,
    openingMark,
    openingMark.to,
    closingMark.from,
    closingMark,
    className,
  );
}

function addInactiveStrikethroughDecorations(
  view: EditorView,
  strikethroughNode: FormattedTextNode,
  decorations: DecorationRange[],
) {
  const line = view.state.doc.lineAt(strikethroughNode.from);
  if (line.to < strikethroughNode.to || lineOverlapsSelection(view, line)) {
    return;
  }

  const marks = strikethroughNode.node.getChildren("StrikethroughMark");
  if (marks.length !== 2) {
    return;
  }

  addDelimitedConcealmentDecorations(
    decorations,
    marks[0],
    marks[0].to,
    marks[1].from,
    marks[1],
    "cm-md-strikethrough",
  );
}

function addInactiveLinkDecorations(
  view: EditorView,
  linkNode: LinkNode,
  decorations: DecorationRange[],
) {
  const line = view.state.doc.lineAt(linkNode.from);
  if (line.to < linkNode.to || lineOverlapsSelection(view, line)) {
    return;
  }

  const linkMarks = linkNode.node.getChildren("LinkMark");
  const url = linkNode.node.getChild("URL");
  if (linkMarks.length !== 4 || !url) {
    return;
  }

  const openingLabelMark = linkMarks[0];
  const closingLabelMark = linkMarks[1];
  const openingDestinationMark = linkMarks[2];
  const closingDestinationMark = linkMarks[3];
  if (
    openingLabelMark.to !== closingLabelMark.from &&
    closingLabelMark.to === openingDestinationMark.from &&
    openingDestinationMark.from <= url.from &&
    url.to <= closingDestinationMark.from
  ) {
    addDelimitedConcealmentDecorations(
      decorations,
      openingLabelMark,
      openingLabelMark.to,
      closingLabelMark.from,
      { from: closingLabelMark.from, to: closingDestinationMark.to },
      "cm-md-link",
    );
  }
}

function addInactiveImageDecorations(
  view: EditorView,
  imageNode: ImageNode,
  decorations: DecorationRange[],
) {
  const line = view.state.doc.lineAt(imageNode.from);
  if (line.to < imageNode.to || lineOverlapsSelection(view, line)) {
    return;
  }

  const linkMarks = imageNode.node.getChildren("LinkMark");
  if (linkMarks.length !== 4) {
    return;
  }

  const altText = view.state.sliceDoc(linkMarks[0].to, linkMarks[1].from).trim();
  decorations.push(
    Decoration.replace({
      widget: new ImagePlaceholderWidget(altText),
    }).range(imageNode.from, imageNode.to),
  );
}

function addDelimitedConcealmentDecorations(
  decorations: DecorationRange[],
  openingMark: SyntaxRange,
  contentFrom: number,
  contentTo: number,
  closingMark: SyntaxRange,
  className: string,
) {
  decorations.push(Decoration.replace({}).range(openingMark.from, openingMark.to));
  if (contentFrom < contentTo) {
    decorations.push(Decoration.mark({ class: className }).range(contentFrom, contentTo));
  }
  decorations.push(Decoration.replace({}).range(closingMark.from, closingMark.to));
}

function codeTextLines(view: EditorView, codeText: SyntaxRange) {
  const lines = [];
  let position = view.state.doc.lineAt(codeText.from).from;

  while (position <= codeText.to) {
    const line = view.state.doc.lineAt(position);
    if (line.to >= codeText.from && line.from <= codeText.to) {
      lines.push(line);
    }

    if (line.to >= codeText.to || line.number === view.state.doc.lines) {
      break;
    }
    position = line.to + 1;
  }

  return lines;
}

function fencedCodeLanguage(view: EditorView, codeInfo: SyntaxRange | null) {
  if (!codeInfo) {
    return null;
  }

  const language = view.state.sliceDoc(codeInfo.from, codeInfo.to).trim().split(/\s+/)[0]?.toLowerCase();
  return language || null;
}

function addInactiveFencedCodeDecorations(
  view: EditorView,
  fencedCodeNode: FencedCodeNode,
  decorations: DecorationRange[],
) {
  const codeMarks = fencedCodeNode.node.getChildren("CodeMark");
  const codeInfo = fencedCodeNode.node.getChild("CodeInfo");
  const codeText = fencedCodeNode.node.getChild("CodeText");
  if (codeMarks.length < 2 || !codeText) {
    return;
  }

  const openingLine = view.state.doc.lineAt(codeMarks[0].from);
  const closingLine = view.state.doc.lineAt(codeMarks[codeMarks.length - 1].from);
  const openingLineIsActive = lineOverlapsSelection(view, openingLine);
  const closingLineIsActive = lineOverlapsSelection(view, closingLine);
  const language = fencedCodeLanguage(view, codeInfo);

  if (!openingLineIsActive) {
    if (language) {
      decorations.push(Decoration.line({ class: "cm-md-fenced-code-language-line" }).range(openingLine.from));
      decorations.push(
        Decoration.widget({
          side: -1,
          widget: new FencedCodeLanguageWidget(language),
        }).range(openingLine.from),
      );
    } else {
      decorations.push(Decoration.line({ class: "cm-md-fenced-code-marker-line" }).range(openingLine.from));
    }
    decorations.push(Decoration.replace({}).range(openingLine.from, openingLine.to));
  }

  const bodyLines = codeTextLines(view, codeText);
  bodyLines.forEach((line, index) => {
    const classes = ["cm-md-fenced-code-line"];
    if (index === 0) {
      classes.push("cm-md-fenced-code-first-line");
    }
    if (index === bodyLines.length - 1) {
      classes.push("cm-md-fenced-code-last-line");
    }
    decorations.push(Decoration.line({ class: classes.join(" ") }).range(line.from));
  });

  if (!closingLineIsActive) {
    decorations.push(Decoration.line({ class: "cm-md-fenced-code-marker-line" }).range(closingLine.from));
    decorations.push(Decoration.replace({}).range(closingLine.from, closingLine.to));
  }
}

function taskMarkerMatch(lineText: string) {
  return /^([ \t]*)- \[([ xX])\](?=$|[ \t])/.exec(lineText);
}

function taskMarkerLike(lineText: string) {
  return /^([ \t]*)- \[[ xX]\]/.test(lineText);
}

function addInactiveListMarkerDecoration(
  view: EditorView,
  listMark: SyntaxRange,
  decorations: DecorationRange[],
  taskLines: Set<number>,
) {
  const line = inactiveLine(view, listMark.from);
  if (!line || taskLines.has(line.from) || taskMarkerLike(line.text)) {
    return;
  }

  const markerText = view.state.sliceDoc(listMark.from, listMark.to);
  const marker = /^\d+[.)]$/.test(markerText) ? markerText : "•";
  decorations.push(
    Decoration.replace({
      widget: new ListMarkerWidget(marker),
    }).range(listMark.from, listMark.to),
  );
}

function addInactiveHorizontalRuleDecoration(
  view: EditorView,
  horizontalRule: SyntaxRange,
  decorations: DecorationRange[],
) {
  const line = inactiveLine(view, horizontalRule.from);
  if (!line) {
    return;
  }

  decorations.push(
    Decoration.replace({
      widget: new HorizontalRuleWidget(),
    }).range(line.from, line.to),
  );
}

function parseMarkdownTable(source: string): MarkdownTable | null {
  const lines = source.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return null;
  }

  const header = parseTableRow(lines[0]);
  const delimiter = parseTableRow(lines[1]);
  if (header.length === 0 || header.length !== delimiter.length || !delimiter.every(isTableDelimiterCell)) {
    return null;
  }

  return {
    header,
    rows: lines.slice(2).map((line) => {
      const row = parseTableRow(line);
      return header.map((_, index) => row[index] ?? "");
    }),
  };
}

function parseTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableDelimiterCell(cell: string) {
  return /^:?-{3,}:?$/.test(cell.trim());
}

function addInactiveTableDecoration(view: EditorView, tableNode: TableNode, decorations: DecorationRange[]) {
  if (selectionOverlapsRange(view, tableNode.from, tableNode.to)) {
    return;
  }

  const table = parseMarkdownTable(view.state.sliceDoc(tableNode.from, tableNode.to));
  if (!table) {
    return;
  }

  const firstLine = view.state.doc.lineAt(tableNode.from);
  decorations.push(
    Decoration.replace({
      widget: new MarkdownTableWidget(table),
    }).range(firstLine.from, firstLine.to),
  );

  let position = firstLine.to + 1;
  while (position <= tableNode.to) {
    const line = view.state.doc.lineAt(position);
    decorations.push(Decoration.replace({}).range(line.from, line.to));
    if (line.to >= tableNode.to || line.number === view.state.doc.lines) {
      break;
    }
    position = line.to + 1;
  }
}

function addInactiveTaskCheckboxDecorations(
  view: EditorView,
  from: number,
  to: number,
  decorations: DecorationRange[],
  taskLines: Set<number>,
) {
  let position = from;

  while (position <= to) {
    const line = view.state.doc.lineAt(position);
    if (!taskLines.has(line.from) && !lineOverlapsSelection(view, line)) {
      const match = taskMarkerMatch(line.text);
      if (match) {
        taskLines.add(line.from);
        const markerFrom = line.from + match[1].length;
        const markerTo = line.from + match[0].length;
        decorations.push(
          Decoration.replace({
            widget: new TaskCheckboxWidget(match[2].toLowerCase() === "x"),
          }).range(markerFrom, markerTo),
        );
      }
    }

    if (line.to >= to || line.number === view.state.doc.lines) {
      break;
    }
    position = line.to + 1;
  }
}

function addInactiveFootnoteDecorations(
  view: EditorView,
  from: number,
  to: number,
  decorations: DecorationRange[],
  footnoteLines: Set<number>,
) {
  let position = from;

  while (position <= to) {
    const line = view.state.doc.lineAt(position);
    if (!footnoteLines.has(line.from) && !lineOverlapsSelection(view, line)) {
      if (!addFootnoteDefinitionDecoration(line, decorations, footnoteLines)) {
        addFootnoteReferenceDecorations(line, decorations);
      }
    }

    if (line.to >= to || line.number === view.state.doc.lines) {
      break;
    }
    position = line.to + 1;
  }
}

function addFootnoteDefinitionDecoration(
  line: { from: number; text: string },
  decorations: DecorationRange[],
  footnoteLines: Set<number>,
) {
  const match = /^\[\^([^\]\s]+)\]:[ \t]*/.exec(line.text);
  if (!match) {
    return false;
  }

  footnoteLines.add(line.from);
  decorations.push(
    Decoration.replace({
      widget: new FootnoteDefinitionWidget(match[1]),
    }).range(line.from, line.from + match[0].length),
  );
  return true;
}

function addFootnoteReferenceDecorations(
  line: { from: number; text: string },
  decorations: DecorationRange[],
) {
  const referencePattern = /\[\^([^\]\s]+)\]/g;
  for (const match of line.text.matchAll(referencePattern)) {
    if (match.index === undefined) {
      continue;
    }
    decorations.push(
      Decoration.replace({
        widget: new FootnoteReferenceWidget(match[1]),
      }).range(line.from + match.index, line.from + match.index + match[0].length),
    );
  }
}

function buildMarkdownLivePreviewDecorations(view: EditorView) {
  const decorations: DecorationRange[] = [];
  const blockquoteLines = new Set<number>();
  const footnoteLines = new Set<number>();
  const taskLines = new Set<number>();
  const tree = syntaxTree(view.state);

  for (const { from, to } of view.visibleRanges) {
    addInactiveTaskCheckboxDecorations(view, from, to, decorations, taskLines);
    addInactiveFootnoteDecorations(view, from, to, decorations, footnoteLines);

    tree.iterate({
      from,
      to,
      enter: (node) => {
        const atxLevel = atxHeadingLevels.get(node.name);
        if (atxLevel) {
          const line = view.state.doc.lineAt(node.from);
          decorations.push(Decoration.line({ class: headingLineClass(atxLevel) }).range(line.from));
          if (!lineOverlapsSelection(view, line)) {
            decorations.push(Decoration.replace({}).range(node.from, atxMarkerEnd(view, node.from, line.to)));
          }
          return;
        }

        if (node.name === "QuoteMark") {
          const line = view.state.doc.lineAt(node.from);
          if (blockquoteLines.has(line.from)) {
            return;
          }

          blockquoteLines.add(line.from);
          decorations.push(Decoration.line({ class: "cm-md-blockquote-line" }).range(line.from));
          if (!lineOverlapsSelection(view, line)) {
            decorations.push(Decoration.replace({}).range(node.from, blockquoteMarkerEnd(view, node.from, line.to)));
          }
          return;
        }

        if (node.name === "InlineCode") {
          addInactiveInlineCodeDecorations(view, node, decorations);
          return false;
        }

        if (node.name === "StrongEmphasis") {
          addInactiveFormattedTextDecorations(view, node, decorations, "cm-md-strong", 2);
          return;
        }

        if (node.name === "Emphasis") {
          addInactiveFormattedTextDecorations(view, node, decorations, "cm-md-emphasis", 1);
          return;
        }

        if (node.name === "Strikethrough") {
          addInactiveStrikethroughDecorations(view, node, decorations);
          return false;
        }

        if (node.name === "Link") {
          addInactiveLinkDecorations(view, node, decorations);
          return;
        }

        if (node.name === "Image") {
          addInactiveImageDecorations(view, node, decorations);
          return false;
        }

        if (node.name === "FencedCode") {
          addInactiveFencedCodeDecorations(view, node, decorations);
          return false;
        }

        if (node.name === "ListMark") {
          addInactiveListMarkerDecoration(view, node, decorations, taskLines);
          return;
        }

        if (node.name === "HorizontalRule") {
          addInactiveHorizontalRuleDecoration(view, node, decorations);
          return false;
        }

        if (node.name === "Table") {
          addInactiveTableDecoration(view, node, decorations);
          return false;
        }

        const setextLevel = setextHeadingLevels.get(node.name);
        if (setextLevel) {
          const titleLine = view.state.doc.lineAt(node.from);
          decorations.push(Decoration.line({ class: headingLineClass(setextLevel) }).range(titleLine.from));
        }
      },
    });
  }

  return Decoration.set(decorations, true);
}

const headingLineDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildMarkdownLivePreviewDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildMarkdownLivePreviewDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

const headingLineTheme = EditorView.theme({
  ".cm-line.cm-md-heading-line": {
    color: "var(--color-text-primary)",
    fontWeight: "700",
    lineHeight: "1.25",
    paddingBottom: "0.18rem",
    paddingTop: "0.55rem",
  },
  ".cm-line.cm-md-heading-1": {
    fontSize: "1.55em",
  },
  ".cm-line.cm-md-heading-2": {
    fontSize: "1.35em",
  },
  ".cm-line.cm-md-heading-3": {
    fontSize: "1.2em",
  },
  ".cm-line.cm-md-heading-4": {
    fontSize: "1.1em",
  },
  ".cm-line.cm-md-heading-5": {
    fontSize: "1.02em",
  },
  ".cm-line.cm-md-heading-6": {
    color: "var(--color-text-secondary)",
    fontSize: "0.98em",
    letterSpacing: "0",
  },
  ".cm-line.cm-md-blockquote-line": {
    borderLeft: "0.18rem solid var(--color-border-strong)",
    color: "var(--color-text-secondary)",
    paddingLeft: "0.7rem",
  },
  ".cm-md-inline-code": {
    backgroundColor: "var(--color-surface-raised)",
    borderRadius: "0.25rem",
    color: "var(--color-text-primary)",
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace",
    padding: "0.05rem 0.22rem",
  },
  ".cm-md-emphasis": {
    fontStyle: "italic",
  },
  ".cm-md-strong": {
    fontWeight: "700",
  },
  ".cm-md-link": {
    color: "var(--color-accent)",
    textDecoration: "underline",
    textUnderlineOffset: "0.16em",
  },
  ".cm-md-strikethrough": {
    textDecoration: "line-through",
  },
  ".cm-md-list-marker": {
    color: "var(--color-text-muted)",
    display: "inline-block",
    minWidth: "1.2em",
  },
  ".cm-md-horizontal-rule": {
    borderTop: "1px solid var(--color-border-strong)",
    display: "inline-block",
    transform: "translateY(-0.28em)",
    width: "100%",
  },
  ".cm-md-image-placeholder": {
    alignItems: "center",
    backgroundColor: "var(--color-surface-raised)",
    border: "1px solid var(--color-border)",
    borderRadius: "0.35rem",
    color: "var(--color-text-secondary)",
    display: "inline-flex",
    gap: "0.45rem",
    maxWidth: "100%",
    padding: "0.18rem 0.5rem",
  },
  ".cm-md-image-placeholder-icon": {
    color: "var(--color-text-muted)",
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace",
    fontSize: "0.72em",
    fontWeight: "700",
  },
  ".cm-md-image-placeholder-label": {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  ".cm-md-footnote-ref": {
    color: "var(--color-accent)",
    fontSize: "0.72em",
    lineHeight: "0",
    verticalAlign: "super",
  },
  ".cm-md-footnote-definition": {
    color: "var(--color-accent)",
    display: "inline-block",
    fontSize: "0.8em",
    fontWeight: "700",
    marginRight: "0.45rem",
  },
  ".cm-md-table": {
    display: "block",
    overflowX: "auto",
    padding: "0.2rem 0",
  },
  ".cm-md-table table": {
    borderCollapse: "collapse",
    color: "var(--color-text-secondary)",
    fontSize: "0.92em",
    width: "100%",
  },
  ".cm-md-table th": {
    color: "var(--color-text-primary)",
    fontWeight: "700",
  },
  ".cm-md-table th, .cm-md-table td": {
    border: "1px solid var(--color-border)",
    padding: "0.28rem 0.45rem",
    textAlign: "left",
  },
  ".cm-md-task-checkbox": {
    border: "1px solid var(--color-border-strong)",
    borderRadius: "0.2rem",
    boxSizing: "border-box",
    display: "inline-block",
    height: "0.9em",
    marginRight: "0.38rem",
    pointerEvents: "none",
    position: "relative",
    top: "0.1em",
    width: "0.9em",
  },
  ".cm-md-task-checkbox-checked": {
    backgroundColor: "var(--color-accent)",
    borderColor: "var(--color-accent)",
  },
  ".cm-md-task-checkbox-checked::after": {
    borderBottom: "0.13em solid var(--color-bg)",
    borderRight: "0.13em solid var(--color-bg)",
    content: "''",
    height: "0.48em",
    left: "0.28em",
    position: "absolute",
    top: "0.1em",
    transform: "rotate(45deg)",
    width: "0.22em",
  },
  ".cm-line.cm-md-fenced-code-marker-line": {
    fontSize: "0",
    height: "0",
    lineHeight: "0",
    overflow: "hidden",
  },
  ".cm-line.cm-md-fenced-code-language-line": {
    backgroundColor: "var(--color-bg)",
    borderTopLeftRadius: "0.4rem",
    borderTopRightRadius: "0.4rem",
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "flex-end",
    padding: "0.45rem 0.65rem 0",
  },
  ".cm-md-fenced-code-language-row": {
    display: "contents",
  },
  ".cm-md-fenced-code-language": {
    backgroundColor: "var(--color-surface-raised)",
    border: "1px solid var(--color-border)",
    borderRadius: "9999px",
    color: "var(--color-text-muted)",
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace",
    fontSize: "0.68rem",
    lineHeight: "1",
    padding: "0.18rem 0.45rem",
  },
  ".cm-line.cm-md-fenced-code-line": {
    backgroundColor: "var(--color-bg)",
    color: "var(--color-text-primary)",
    fontFamily: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace",
    lineHeight: "1.55",
    paddingLeft: "0.9rem",
    paddingRight: "0.9rem",
  },
  ".cm-line.cm-md-fenced-code-first-line": {
    borderTopLeftRadius: "0.4rem",
    borderTopRightRadius: "0.4rem",
    paddingTop: "0.75rem",
  },
  ".cm-line.cm-md-fenced-code-last-line": {
    borderBottomLeftRadius: "0.4rem",
    borderBottomRightRadius: "0.4rem",
    paddingBottom: "0.75rem",
  },
});

export const markdownLivePreviewExtension = [
  EditorView.editorAttributes.of({
    class: "cm-markdown-live-preview",
  }),
  headingLineDecorations,
  headingLineTheme,
];
