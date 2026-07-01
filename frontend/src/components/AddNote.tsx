import type { RefObject } from "react";

import { APP_SHORTCUTS } from "../hooks/useKeyboardShortcuts";

type AddNoteProps = {
  captureRef: RefObject<HTMLTextAreaElement | null>;
  draftText: string;
  error: string | null;
  isSaving: boolean;
  onDraftTextChange: (value: string) => void;
  onSave: () => void;
};

export function AddNote({ captureRef, draftText, error, isSaving, onDraftTextChange, onSave }: AddNoteProps) {
  return (
    <div className="flex flex-col gap-3" aria-labelledby="add-note-title">
      <h2 className="sr-only" id="add-note-title">
        Capture a note
      </h2>
      <textarea
        className="min-h-48 w-full resize-y rounded-lg border border-border bg-surface-raised px-3.5 py-3 text-sm leading-relaxed text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
        disabled={isSaving}
        onChange={(event) => onDraftTextChange(event.target.value)}
        placeholder="Paste an email, instruction, ticket note, mapping rule, or any messy work text — the AI will organize it."
        ref={captureRef}
        rows={6}
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
          {draftText.trim() ? `${draftText.trim().length} chars` : `${APP_SHORTCUTS.capture.label} to focus`}
        </span>
      </div>
    </div>
  );
}
