import type { RefObject } from "react";

import { MarkdownPreview } from "./MarkdownPreview";

export type MarkdownPaneProps = {
  mode: "edit" | "read";
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  placeholder?: string;
};

export function MarkdownPane({
  disabled = false,
  mode,
  onChange,
  placeholder,
  textareaRef,
  value,
}: MarkdownPaneProps) {
  if (mode === "read") {
    return (
      <div className="min-h-72 overflow-y-auto rounded-md border border-border bg-surface-raised px-4 py-3">
        <MarkdownPreview source={value} />
      </div>
    );
  }

  return (
    <textarea
      aria-label="Markdown source"
      className="min-h-72 w-full resize-y rounded-md border border-border bg-surface-raised px-3.5 py-3 text-sm leading-relaxed text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60 md:min-h-[28rem]"
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value)}
      placeholder={placeholder}
      readOnly={!onChange}
      ref={textareaRef}
      value={value}
    />
  );
}
