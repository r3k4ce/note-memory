import type { RefObject } from "react";

import { APP_SHORTCUTS } from "../hooks/useKeyboardShortcuts";
import type { Category } from "../types";
import { MarkdownEditor } from "./MarkdownEditor";

type AddNoteProps = {
  captureRef: RefObject<HTMLTextAreaElement | null>;
  categories: Category[];
  draftText: string;
  error: string | null;
  isSaving: boolean;
  onCategoryChange: (categoryId: number | null) => void;
  onDraftTextChange: (value: string) => void;
  onSave: () => void;
  selectedCategoryId: number | null;
};

export function AddNote({
  captureRef,
  categories,
  draftText,
  error,
  isSaving,
  onCategoryChange,
  onDraftTextChange,
  onSave,
  selectedCategoryId,
}: AddNoteProps) {
  return (
    <div className="flex flex-col gap-3" aria-labelledby="add-note-title">
      <h2 className="sr-only" id="add-note-title">
        Capture a note
      </h2>
      {categories.length > 0 ? (
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor="capture-category">
            Category
          </label>
          <select
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
            disabled={isSaving}
            id="capture-category"
            onChange={(event) => onCategoryChange(event.target.value ? Number(event.target.value) : null)}
            value={selectedCategoryId ?? ""}
          >
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <MarkdownEditor
        disabled={isSaving}
        onChange={onDraftTextChange}
        placeholder="Paste a note in Markdown - the AI will organize it."
        rows={10}
        textareaId="capture-markdown"
        textareaLabel="Capture note Markdown"
        textareaRef={captureRef}
        value={draftText}
      />
      {error ? <p className="text-xs text-error">{error}</p> : null}
      <div className="flex items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isSaving}
          onClick={onSave}
          type="button"
        >
          {isSaving ? "Organizing..." : "Organize & save"}
        </button>
        <span className="text-[11px] text-text-muted">
          {draftText.trim() ? `${draftText.length} chars` : `${APP_SHORTCUTS.capture.label} to focus`}
        </span>
      </div>
    </div>
  );
}
