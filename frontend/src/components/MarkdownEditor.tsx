import { useId, useState, type RefObject } from "react";

import { MarkdownPreview } from "./MarkdownPreview";

type MarkdownEditorProps = {
  disabled?: boolean;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  textareaId?: string;
  textareaLabel?: string;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  value: string;
};

type MobilePane = "write" | "preview";

export function MarkdownEditor({
  disabled = false,
  onChange,
  placeholder,
  rows = 10,
  textareaId,
  textareaLabel = "Markdown source",
  textareaRef,
  value,
}: MarkdownEditorProps) {
  const generatedId = useId();
  const editorId = textareaId ?? generatedId;
  const [mobilePane, setMobilePane] = useState<MobilePane>("write");

  const writePane = (
    <div className="flex min-h-0 flex-col gap-2">
      <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor={editorId}>
        Write
      </label>
      <textarea
        aria-label={textareaLabel}
        className="min-h-72 w-full flex-1 resize-y rounded-lg border border-border bg-surface-raised px-3.5 py-3 text-sm leading-relaxed text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60 md:min-h-[28rem]"
        disabled={disabled}
        id={editorId}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        ref={textareaRef}
        rows={rows}
        value={value}
      />
    </div>
  );

  const previewPane = (
    <div className="flex min-h-0 flex-col gap-2">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Preview</h3>
      <div className="min-h-72 flex-1 overflow-y-auto rounded-lg border border-border bg-surface-raised px-4 py-3 md:min-h-[28rem]">
        <MarkdownPreview source={value} />
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex rounded-md border border-border bg-surface p-0.5 md:hidden" role="tablist" aria-label="Markdown editor view">
        {(["write", "preview"] as const).map((pane) => {
          const isActive = mobilePane === pane;
          return (
            <button
              aria-selected={isActive}
              className={`flex-1 rounded px-3 py-1.5 text-[13px] font-medium capitalize transition-colors ${
                isActive
                  ? "bg-surface-raised text-text-primary"
                  : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
              }`}
              key={pane}
              onClick={() => setMobilePane(pane)}
              role="tab"
              type="button"
            >
              {pane}
            </button>
          );
        })}
      </div>

      <div className="md:hidden">{mobilePane === "write" ? writePane : previewPane}</div>

      <div className="hidden min-h-0 grid-cols-2 gap-4 md:grid">
        {writePane}
        {previewPane}
      </div>
    </div>
  );
}
