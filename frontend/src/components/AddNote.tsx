import type { RefObject } from "react";

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
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-brand">Capture</p>
        <h2 className="text-base font-semibold text-text-primary" id="add-note-title">
          Capture mapping note
        </h2>
      </div>
      <textarea
        className="min-h-28 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:opacity-60"
        disabled={isSaving}
        onChange={(event) => onDraftTextChange(event.target.value)}
        placeholder="Paste an email, source instruction, ticket note, mapping rule, or messy work note..."
        ref={captureRef}
        rows={4}
        value={draftText}
      />
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        className="w-fit rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        disabled={isSaving}
        onClick={onSave}
        type="button"
      >
        {isSaving ? "Organizing..." : "Organize and save"}
      </button>
    </div>
  );
}
