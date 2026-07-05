import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { StateField, type EditorState } from "@codemirror/state";

type FrontmatterRange = {
  from: number;
  to: number;
};

class FrontmatterWidget extends WidgetType {
  eq(widget: WidgetType) {
    return widget instanceof FrontmatterWidget;
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "cm-note-frontmatter-widget";
    wrapper.textContent = "Note details";
    return wrapper;
  }
}

function frontmatterRange(state: EditorState): FrontmatterRange | null {
  const doc = state.doc;
  if (doc.lines < 3 || doc.line(1).text !== "---") {
    return null;
  }

  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber += 1) {
    const line = doc.line(lineNumber);
    if (line.text === "---") {
      return { from: 0, to: line.to };
    }
  }

  return null;
}

function selectionOverlapsRange(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((range) => {
    if (range.empty) {
      return from <= range.head && range.head <= to;
    }

    return range.from <= to && range.to >= from;
  });
}

function buildFrontmatterDecorations(state: EditorState): DecorationSet {
  const range = frontmatterRange(state);
  if (!range || selectionOverlapsRange(state, range.from, range.to)) {
    return Decoration.none;
  }

  return Decoration.set([
    Decoration.replace({
      widget: new FrontmatterWidget(),
    }).range(range.from, range.to),
  ]);
}

const frontmatterPreviewField = StateField.define<DecorationSet>({
  create(state) {
    return buildFrontmatterDecorations(state);
  },
  update(decorations, transaction) {
    if (transaction.docChanged || transaction.selection) {
      return buildFrontmatterDecorations(transaction.state);
    }

    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

const frontmatterPreviewTheme = EditorView.theme({
  ".cm-note-frontmatter-widget": {
    boxSizing: "border-box",
    width: "100%",
    borderRadius: "0.375rem",
    backgroundColor: "var(--color-surface)",
    color: "var(--color-text-muted)",
    fontSize: "0.75rem",
    fontWeight: "600",
    letterSpacing: "0",
    margin: "0 0 0.5rem",
    padding: "0.375rem 0.625rem",
  },
});

export const frontmatterPreviewExtension = [frontmatterPreviewField, frontmatterPreviewTheme];
