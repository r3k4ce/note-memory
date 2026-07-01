import { useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";

import type { Note, NoteMetadataUpdate } from "../types";

type NoteDetailProps = {
  deleteError: string | null;
  error: string | null;
  isDeleting: boolean;
  isLoading: boolean;
  isSavingMetadata: boolean;
  note: Note | null;
  onDelete: (noteId: number) => Promise<void>;
  onSaveMetadata: (noteId: number, metadata: NoteMetadataUpdate) => Promise<void>;
  saveError: string | null;
};

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function tagsMatch(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

export function NoteDetail({
  deleteError,
  error,
  isDeleting,
  isLoading,
  isSavingMetadata,
  note,
  onDelete,
  onSaveMetadata,
  saveError,
}: NoteDetailProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center py-20">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
          Loading note...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-20">
        <p className="text-sm font-medium text-text-primary">Could not load note</p>
        <p className="text-xs text-error">{error}</p>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 py-20">
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-surface-raised">
          <Pencil size={18} strokeWidth={1.5} className="text-text-muted" />
        </div>
        <p className="text-sm font-medium text-text-secondary">No note selected</p>
        <p className="text-xs text-text-muted">Select a note from the list, or capture a new one.</p>
      </div>
    );
  }

  const activeNote = note;
  const title = titleDraft.trim();
  const summary = summaryDraft.trim();
  const tags = parseTags(tagsDraft);
  const hasChanges =
    activeNote.ai_title !== title ||
    activeNote.short_summary !== summary ||
    !tagsMatch(activeNote.tags, tags);
  const canSave = Boolean(title && summary && hasChanges && !isSavingMetadata);
  const actionsDisabled = isSavingMetadata || isDeleting;

  async function handleSave() {
    if (!title || !summary) {
      setValidationError("Title and summary cannot be blank.");
      return;
    }

    setValidationError(null);

    try {
      await onSaveMetadata(activeNote.id, {
        ai_title: title,
        short_summary: summary,
        tags,
      });
      setIsEditing(false);
    } catch {
      // Keep the draft open; App renders the API error.
    }
  }

  function handleCancel() {
    setIsEditing(false);
    setValidationError(null);
    setTitleDraft(activeNote.ai_title);
    setSummaryDraft(activeNote.short_summary);
    setTagsDraft(activeNote.tags.join(", "));
  }

  return (
    <article className="mx-auto flex h-full max-w-3xl flex-col gap-6 py-2">
      <header className="flex flex-col gap-3">
        {isEditing ? (
          <input
            aria-label="Note title"
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-xl font-semibold leading-tight text-text-primary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
            disabled={isSavingMetadata}
            onChange={(event) => {
              setTitleDraft(event.target.value);
              setValidationError(null);
            }}
            value={titleDraft}
          />
        ) : (
          <h2 className="text-xl font-semibold leading-tight text-text-primary">{activeNote.ai_title}</h2>
        )}
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          <time dateTime={activeNote.date_added}>{activeNote.date_added}</time>
          <span className="text-border-strong">·</span>
          <time dateTime={activeNote.updated_at}>updated {activeNote.updated_at}</time>
        </div>
      </header>

      {isEditing ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor="tags-input">
            Tags
          </label>
          <input
            className="w-full rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
            disabled={isSavingMetadata}
            id="tags-input"
            onChange={(event) => setTagsDraft(event.target.value)}
            value={tagsDraft}
          />
        </div>
      ) : (
        activeNote.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" aria-label="Tags">
            {activeNote.tags.map((tag) => (
              <span
                className="rounded border border-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-text-secondary"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null
      )}

      <div className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Summary</h3>
        {isEditing ? (
          <textarea
            aria-label="Note summary"
            className="min-h-24 w-full resize-y rounded-md border border-border bg-surface-raised px-3 py-2 text-sm leading-relaxed text-text-primary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
            disabled={isSavingMetadata}
            onChange={(event) => {
              setSummaryDraft(event.target.value);
              setValidationError(null);
            }}
            value={summaryDraft}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
            {activeNote.short_summary}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Original text</h3>
        <div className="rounded-md border border-border bg-surface-raised px-4 py-3 font-mono text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap">
          {activeNote.original_text}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {isEditing ? (
          <>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-black transition-colors hover:bg-accent-hover disabled:opacity-40"
              disabled={!canSave}
              onClick={handleSave}
              type="button"
            >
              {isSavingMetadata ? "Saving..." : "Save changes"}
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40"
              disabled={actionsDisabled}
              onClick={handleCancel}
              type="button"
            >
              <X size={13} strokeWidth={2} />
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40"
              disabled={actionsDisabled}
              onClick={() => {
                setTitleDraft(activeNote.ai_title);
                setSummaryDraft(activeNote.short_summary);
                setTagsDraft(activeNote.tags.join(", "));
                setValidationError(null);
                setIsEditing(true);
              }}
              type="button"
            >
              <Pencil size={13} strokeWidth={2} />
              Edit
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-error/20 px-3 py-1.5 text-[13px] font-medium text-error transition-colors hover:bg-error-muted disabled:opacity-40"
              disabled={actionsDisabled}
              onClick={() => void onDelete(activeNote.id)}
              type="button"
            >
              <Trash2 size={13} strokeWidth={2} />
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </>
        )}
      </div>

      {validationError ? <p className="text-xs text-error">{validationError}</p> : null}
      {saveError ? <p className="text-xs text-error">{saveError}</p> : null}
      {deleteError ? <p className="text-xs text-error">{deleteError}</p> : null}
    </article>
  );
}
