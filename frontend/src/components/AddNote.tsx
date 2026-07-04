import type { RefObject } from "react";

import { APP_SHORTCUTS } from "../hooks/useKeyboardShortcuts";
import type { Category } from "../types";
import { MarkdownPane, type MarkdownPaneHandle } from "./MarkdownPane";

type AddNoteProps = {
  captureRef: RefObject<MarkdownPaneHandle | null>;
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
    <div className="flex h-full min-h-0 flex-col" aria-labelledby="add-note-title">
      <h2 className="sr-only" id="add-note-title">
        New note
      </h2>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          {categories.length > 0 ? (
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="capture-category">
                Category
              </label>
              <select
                className="max-w-48 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-primary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
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
          {error ? <p className="text-xs text-error">{error}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] text-text-muted">
            {draftText.trim() ? `${draftText.length} chars` : `${APP_SHORTCUTS.capture.label} to focus`}
          </span>
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isSaving}
            onClick={onSave}
            type="button"
          >
            {isSaving ? "Saving..." : "Save note"}
          </button>
        </div>
      </div>
      <MarkdownPane
        disabled={isSaving}
        editorHandleRef={captureRef}
        mode="edit"
        onChange={onDraftTextChange}
        placeholder="Write in Markdown... AI will organize it with a title, summary, and tags after save."
        value={draftText}
        variant="workspace"
      />
    </div>
  );
}
