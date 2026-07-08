import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { tags } from "@lezer/highlight";
import type { ReactNode, Ref, RefObject } from "react";

import { MarkdownPageSurface } from "./MarkdownPageSurface";
import { MarkdownPreview } from "./MarkdownPreview";
import { categoryCompletionExtension } from "../editor/categoryCompletion";
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
  surfaceRef?: Ref<HTMLDivElement>;
  toolbar?: ReactNode;
  variant?: "contained" | "workspace";
};

const codeFont = "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', monospace";

const markdownEditorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "transparent",
      color: "var(--color-text-primary)",
      fontSize: "1rem",
      lineHeight: "1.75",
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-content": {
      caretColor: "var(--color-text-primary)",
      minHeight: "24rem",
      padding: "0.875rem 1rem",
    },
    ".cm-line": {
      padding: "0",
    },
    ".cm-scroller": {
      fontFamily: "inherit",
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
];

const workspaceMarkdownEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    minHeight: "0",
  },
  ".cm-editor": {
    display: "flex",
    flexDirection: "column",
    flex: "1",
    height: "auto",
    minHeight: "0",
  },
  ".cm-scroller": {
    flex: "1",
    height: "auto",
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
  surfaceRef,
  toolbar,
  editorHandleRef,
  variant = "contained",
  value,
}: MarkdownPaneProps) {
  if (mode === "read") {
    return <MarkdownPreview source={value} surfaceRef={surfaceRef} toolbar={toolbar} />;
  }

  const editable = !disabled && Boolean(onChange);
  const isWorkspace = variant === "workspace";
  const categoryExtensions = categoryNames.length > 0 ? [categoryCompletionExtension(categoryNames)] : [];
  const extensions = isWorkspace
    ? [...markdownEditorExtensions, ...categoryExtensions, workspaceMarkdownEditorTheme]
    : [...markdownEditorExtensions, ...categoryExtensions];

  const editor = (
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
      minHeight={isWorkspace ? "0" : "24rem"}
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

  if (isWorkspace) {
    return (
      <MarkdownPageSurface surfaceRef={surfaceRef} toolbar={toolbar}>
        {editor}
      </MarkdownPageSurface>
    );
  }

  return editor;
}
