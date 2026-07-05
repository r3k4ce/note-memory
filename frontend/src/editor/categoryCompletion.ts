import {
  autocompletion,
  type Completion,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

function lineIsInsideFrontmatter(doc: { line: (number: number) => { text: string }; lines: number }, lineNumber: number): boolean {
  if (doc.lines < 3 || doc.line(1).text !== "---") {
    return false;
  }

  for (let currentLine = 2; currentLine <= doc.lines; currentLine += 1) {
    if (doc.line(currentLine).text === "---") {
      return lineNumber < currentLine;
    }
  }

  return false;
}

export function categoryCompletionSource(categoryNames: string[]): CompletionSource {
  return (context): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    if (!lineIsInsideFrontmatter(context.state.doc, line.number)) {
      return null;
    }

    const textBeforeCursor = context.state.sliceDoc(line.from, context.pos);
    const match = /^(category:\s*)(.*)$/i.exec(textBeforeCursor);
    if (!match) {
      return null;
    }

    const [, prefix, typedCategory] = match;
    const trimmedCategory = typedCategory.trim();
    const options: Completion[] = categoryNames.map((categoryName) => ({
      label: categoryName,
      type: "constant",
    }));
    const exactMatch = categoryNames.some(
      (categoryName) => categoryName.toLowerCase() === trimmedCategory.toLowerCase(),
    );

    if (trimmedCategory && !exactMatch) {
      options.push({
        label: trimmedCategory,
        type: "keyword",
        detail: "Create category",
        apply: trimmedCategory,
      });
    }

    return {
      from: line.from + prefix.length,
      options,
      validFor: /^[^\n]*$/,
    };
  };
}

export function categoryCompletionExtension(categoryNames: string[]): Extension {
  return autocompletion({
    override: [categoryCompletionSource(categoryNames)],
  });
}
