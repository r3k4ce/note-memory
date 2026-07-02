import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { tags } from "@lezer/highlight";
import type { RefObject } from "react";

import { MarkdownPreview } from "./MarkdownPreview";

export type MarkdownPaneHandle = {
  focus: () => void;
};

export type MarkdownPaneProps = {
  mode: "edit" | "read";
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  id?: string;
  editorHandleRef?: RefObject<MarkdownPaneHandle | null>;
  placeholder?: string;
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
  { dark: true },
);

const markdownHighlightStyle = HighlightStyle.define([
  { tag: [tags.heading1, tags.heading2, tags.heading3, tags.heading], color: "var(--color-text-primary)", fontWeight: "600" },
  { tag: tags.link, color: "var(--color-accent)", textDecoration: "underline", textUnderlineOffset: "0.16em" },
  { tag: tags.url, color: "var(--color-accent)" },
  { tag: tags.emphasis, color: "var(--color-text-primary)", fontStyle: "italic" },
  { tag: tags.strong, color: "var(--color-text-primary)", fontWeight: "600" },
  { tag: [tags.monospace, tags.processingInstruction], color: "var(--color-text-secondary)", fontFamily: codeFont },
  { tag: [tags.list, tags.quote, tags.contentSeparator, tags.meta], color: "var(--color-text-muted)" },
  { tag: tags.punctuation, color: "var(--color-text-muted)" },
]);

const markdownEditorExtensions = [markdown(), markdownEditorTheme, syntaxHighlighting(markdownHighlightStyle)];

export function MarkdownPane({
  disabled = false,
  id,
  mode,
  onChange,
  placeholder,
  editorHandleRef,
  value,
}: MarkdownPaneProps) {
  if (mode === "read") {
    return (
      <div className="min-h-72 overflow-y-auto rounded-md border border-border bg-surface-raised px-4 py-3">
        <MarkdownPreview source={value} />
      </div>
    );
  }

  const editable = !disabled && Boolean(onChange);

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
      className={`markdown-codemirror${disabled ? " markdown-codemirror-disabled" : ""}`}
      editable={editable}
      extensions={markdownEditorExtensions}
      height="auto"
      id={id}
      indentWithTab={false}
      minHeight="20rem"
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
