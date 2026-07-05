import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { tags } from "@lezer/highlight";
import type { RefObject } from "react";

import { MarkdownPreview } from "./MarkdownPreview";
import { categoryCompletionExtension } from "../editor/categoryCompletion";
import { frontmatterPreviewExtension } from "../editor/frontmatterPreview";
import { markdownCodeLanguages } from "../editor/markdownCodeLanguages";
import { markdownLivePreviewExtension } from "../editor/markdownLivePreview";
import { THEME_MODE, type ThemeId } from "../hooks/useTheme";

export type MarkdownPaneHandle = {
  focus: () => void;
};

export type MarkdownPaneProps = {
  mode: "edit" | "read";
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  categoryNames?: string[];
  id?: string;
  editorHandleRef?: RefObject<MarkdownPaneHandle | null>;
  placeholder?: string;
  variant?: "contained" | "workspace";
};

const codeFont = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace";

const markdownEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "var(--color-text-primary)",
      fontSize: "0.9375rem",
      lineHeight: "1.7",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-content": {
      caretColor: "var(--color-text-primary)",
      minHeight: "20rem",
      padding: "0.875rem 1rem",
    },
    ".cm-line": {
      padding: "0",
    },
    ".cm-scroller": {
      fontFamily: "inherit",
      maxHeight: "clamp(20rem, calc(100vh - 18rem), 36rem)",
      overflow: "auto",
    },
    ".cm-gutters": {
      display: "none",
    },
    ".cm-placeholder": {
      color: "var(--color-text-muted)",
    },
    ".cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--color-accent-soft)",
    },
    ".cm-activeLine": {
      backgroundColor: "transparent",
    },
  },
  { dark: THEME_MODE[(document.documentElement.dataset.theme ?? "dark") as ThemeId] === "dark" },
);

const markdownHighlightStyle = HighlightStyle.define([
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading], color: "var(--color-text-primary)", fontWeight: "600" },
  { tag: tags.link, color: "var(--color-accent)", textDecoration: "underline", textUnderlineOffset: "0.16em" },
  { tag: tags.url, color: "var(--color-accent)" },
  { tag: tags.emphasis, color: "var(--color-text-primary)", fontStyle: "italic" },
  { tag: tags.strong, color: "var(--color-text-primary)", fontWeight: "600" },
  { tag: tags.keyword, color: "var(--color-accent)", fontWeight: "600" },
  { tag: tags.string, color: "var(--color-text-primary)" },
  { tag: tags.number, color: "var(--color-accent)" },
  { tag: tags.comment, color: "var(--color-text-muted)", fontStyle: "italic" },
  { tag: tags.operator, color: "var(--color-text-secondary)" },
  { tag: [tags.monospace, tags.processingInstruction], color: "var(--color-text-secondary)", fontFamily: codeFont },
  { tag: [tags.list, tags.quote, tags.contentSeparator, tags.meta], color: "var(--color-text-muted)" },
  { tag: tags.punctuation, color: "var(--color-text-muted)" },
]);

const markdownEditorExtensions = [
  markdown({ base: markdownLanguage, codeLanguages: markdownCodeLanguages }),
  markdownEditorTheme,
  syntaxHighlighting(markdownHighlightStyle),
  markdownLivePreviewExtension,
  frontmatterPreviewExtension,
];

const workspaceMarkdownEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "0",
  },
  ".cm-editor": {
    height: "100%",
    minHeight: "0",
  },
  ".cm-scroller": {
    height: "100%",
    minHeight: "0",
    maxHeight: "none",
    overflow: "auto",
  },
  ".cm-content": {
    minHeight: "100%",
  },
});

export function MarkdownPane({
  categoryNames = [],
  disabled = false,
  id,
  mode,
  onChange,
  placeholder,
  editorHandleRef,
  variant = "contained",
  value,
}: MarkdownPaneProps) {
  if (mode === "read") {
    return (
      <div className="min-h-72 overflow-y-auto rounded-md bg-surface px-4 py-3">
        <MarkdownPreview source={value} />
      </div>
    );
  }

  const editable = !disabled && Boolean(onChange);
  const isWorkspace = variant === "workspace";
  const categoryExtensions = categoryNames.length > 0 ? [categoryCompletionExtension(categoryNames)] : [];
  const extensions = isWorkspace
    ? [...markdownEditorExtensions, ...categoryExtensions, workspaceMarkdownEditorTheme]
    : [...markdownEditorExtensions, ...categoryExtensions];

  return (
    <CodeMirror
      aria-label="Markdown source"
      basicSetup={{
        autocompletion: false,
        closeBrackets: true,
        completionKeymap: false,
        foldGutter: false,
        foldKeymap: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: false,
        lineNumbers: false,
        lintKeymap: false,
      }}
      className={`markdown-codemirror${isWorkspace ? " markdown-codemirror-workspace" : ""}${
        disabled ? " markdown-codemirror-disabled" : ""
      }`}
      editable={editable}
      extensions={extensions}
      height={isWorkspace ? "100%" : "auto"}
      id={id}
      indentWithTab={false}
      minHeight={isWorkspace ? "0" : "20rem"}
      onChange={(nextValue) => onChange?.(nextValue)}
      onCreateEditor={(view) => {
        if (editorHandleRef) {
          editorHandleRef.current = {
            focus: () => view.focus(),
          };
        }
      }}
      placeholder={placeholder}
      readOnly={!editable}
      theme="none"
      value={value}
    />
  );
}
