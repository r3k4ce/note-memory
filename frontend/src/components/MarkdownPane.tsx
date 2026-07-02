import { markdown } from "@codemirror/lang-markdown";
import CodeMirror from "@uiw/react-codemirror";
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
      extensions={[markdown()]}
      height="auto"
      id={id}
      indentWithTab={false}
      minHeight="18rem"
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
