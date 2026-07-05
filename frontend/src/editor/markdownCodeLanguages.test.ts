import { LanguageDescription } from "@codemirror/language";
import { describe, expect, test } from "vitest";

import { markdownCodeLanguages } from "./markdownCodeLanguages";

describe("markdownCodeLanguages", () => {
  test("matches popular fenced code language aliases", () => {
    const aliases = [
      "js",
      "javascript",
      "ts",
      "typescript",
      "tsx",
      "jsx",
      "html",
      "css",
      "json",
      "python",
      "py",
      "bash",
      "shell",
      "sql",
      "yaml",
      "yml",
      "markdown",
      "md",
    ];

    for (const alias of aliases) {
      expect(LanguageDescription.matchLanguageName(markdownCodeLanguages, alias), alias).toBeTruthy();
    }
  });
});
