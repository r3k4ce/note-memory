import { syntaxTree } from "@codemirror/language";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

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
});

export const markdownLivePreviewExtension = [
  EditorView.editorAttributes.of({
    class: "cm-markdown-live-preview",
  }),
  headingLineDecorations,
  headingLineTheme,
];
