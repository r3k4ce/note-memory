import type { RefObject } from "react";

import { APP_SHORTCUTS } from "../hooks/useKeyboardShortcuts";
import type { Category } from "../types";
import { getNoteEditorBody } from "../editor/noteEditorDocument";
import { MarkdownPane, type MarkdownPaneHandle } from "./MarkdownPane";
import { MarkdownPreview } from "./MarkdownPreview";

type AddNoteProps = {
  captureRef: RefObject<MarkdownPaneHandle | null>;
  categories: Category[];
  draftText: string;
  error: string | null;
  isSaving: boolean;
  onDraftTextChange: (value: string) => void;
  onSave: () => void;
  readMode?: boolean;
};

export function AddNote({
  captureRef,
  categories,
  draftText,
  error,
  isSaving,
  onDraftTextChange,
  onSave,
  readMode = false,
}: AddNoteProps) {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-labelledby="add-note-title">
      <h2 className="sr-only" id="add-note-title">
        New note
      </h2>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
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
      {readMode ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <MarkdownPreview source={getNoteEditorBody(draftText)} />
        </div>
      ) : (
        <MarkdownPane
          categoryNames={categories.map((category) => category.name)}
          disabled={isSaving}
          editorHandleRef={captureRef}
          mode="edit"
          onChange={onDraftTextChange}
          placeholder="Write in Markdown..."
          value={draftText}
          variant="workspace"
        />
      )}
    </div>
  );
}
