import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";

import { categoryCompletionSource } from "./categoryCompletion";

function completions(doc: string, marker = "|") {
  const pos = doc.indexOf(marker);
  const cleanDoc = doc.replace(marker, "");
  const state = EditorState.create({ doc: cleanDoc });

  return categoryCompletionSource(["Work", "Personal"])(
    new CompletionContext(state, pos, false),
  ) as CompletionResult | null;
}

describe("categoryCompletionSource", () => {
  test("suggests existing categories on the frontmatter category line", () => {
    const result = completions(["---", "title: T", "category: Wo|", "---", "", "Body"].join("\n"));

    expect(result?.from).toBe("---\ntitle: T\ncategory: ".length);
    expect(result?.options.map((option) => option.label)).toEqual(["Work", "Personal", "Wo"]);
    expect(result?.options[2]).toMatchObject({ detail: "Create category", apply: "Wo" });
  });

  test("does not suggest categories outside frontmatter", () => {
    expect(completions(["# Body", "", "category: Wo|"].join("\n"))).toBeNull();
  });
});
