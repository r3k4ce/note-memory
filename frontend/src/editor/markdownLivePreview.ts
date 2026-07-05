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

type FencedCodeNode = SyntaxRange & {
  node: {
    getChild: (type: string) => SyntaxRange | null;
    getChildren: (type: string) => SyntaxRange[];
  };
};

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

function headingLineClass(level: number) {
  return `cm-md-heading-line cm-md-heading-${level}`;
}

function lineOverlapsSelection(view: EditorView, lineFrom: number, lineTo: number) {
  return view.state.selection.ranges.some((range) => {
    if (range.empty) {
      return lineFrom <= range.head && range.head <= lineTo;
    }

    return range.from <= lineTo && range.to >= lineFrom;
  });
}

function rangeOverlapsSelection(view: EditorView, from: number, to: number) {
  return view.state.selection.ranges.some((range) => {
    if (range.empty) {
      return from <= range.head && range.head <= to;
    }

    return range.from <= to && range.to >= from;
  });
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

function addInactiveInlineCodeDecorations(
  view: EditorView,
  inlineCodeNode: InlineCodeNode,
  decorations: ReturnType<Decoration["range"]>[],
) {
  const line = view.state.doc.lineAt(inlineCodeNode.from);
  if (lineOverlapsSelection(view, line.from, line.to)) {
    return;
  }

  const codeMarks = inlineCodeNode.node.getChildren("CodeMark");
  if (codeMarks.length < 2) {
    return;
  }

  const openingMark = codeMarks[0];
  const closingMark = codeMarks[codeMarks.length - 1];
  decorations.push(Decoration.replace({}).range(openingMark.from, openingMark.to));
  if (openingMark.to < closingMark.from) {
    decorations.push(
      Decoration.mark({ class: "cm-md-inline-code" }).range(openingMark.to, closingMark.from),
    );
  }
  decorations.push(Decoration.replace({}).range(closingMark.from, closingMark.to));
}

function addInactiveFormattedTextDecorations(
  view: EditorView,
  formattedTextNode: FormattedTextNode,
  decorations: ReturnType<Decoration["range"]>[],
  className: string,
  markerLength: number,
) {
  const line = view.state.doc.lineAt(formattedTextNode.from);
  if (
    line.to < formattedTextNode.to ||
    lineOverlapsSelection(view, line.from, line.to) ||
    formattedTextNode.node.getChildren("Emphasis").length > 0 ||
    formattedTextNode.node.getChildren("StrongEmphasis").length > 0
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

  decorations.push(Decoration.replace({}).range(openingMark.from, openingMark.to));
  if (openingMark.to < closingMark.from) {
    decorations.push(Decoration.mark({ class: className }).range(openingMark.to, closingMark.from));
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
  decorations: ReturnType<Decoration["range"]>[],
) {
  if (rangeOverlapsSelection(view, fencedCodeNode.from, fencedCodeNode.to)) {
    return;
  }

  const codeMarks = fencedCodeNode.node.getChildren("CodeMark");
  const codeInfo = fencedCodeNode.node.getChild("CodeInfo");
  const codeText = fencedCodeNode.node.getChild("CodeText");
  if (codeMarks.length < 2 || !codeText) {
    return;
  }

  const openingLine = view.state.doc.lineAt(codeMarks[0].from);
  const closingLine = view.state.doc.lineAt(codeMarks[codeMarks.length - 1].from);
  const language = fencedCodeLanguage(view, codeInfo);
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

  decorations.push(Decoration.line({ class: "cm-md-fenced-code-marker-line" }).range(closingLine.from));
  decorations.push(Decoration.replace({}).range(closingLine.from, closingLine.to));
}

function buildMarkdownLivePreviewDecorations(view: EditorView) {
  const decorations: ReturnType<Decoration["range"]>[] = [];
  const blockquoteLines = new Set<number>();
  const tree = syntaxTree(view.state);

  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const atxLevel = atxHeadingLevels.get(node.name);
        if (atxLevel) {
          const line = view.state.doc.lineAt(node.from);
          decorations.push(Decoration.line({ class: headingLineClass(atxLevel) }).range(line.from));
          if (!lineOverlapsSelection(view, line.from, line.to)) {
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
          if (!lineOverlapsSelection(view, line.from, line.to)) {
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
          return false;
        }

        if (node.name === "Emphasis") {
          addInactiveFormattedTextDecorations(view, node, decorations, "cm-md-emphasis", 1);
          return false;
        }

        if (node.name === "FencedCode") {
          addInactiveFencedCodeDecorations(view, node, decorations);
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
