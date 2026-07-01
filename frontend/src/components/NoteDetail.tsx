import { useState } from "react";

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
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-4 sm:p-5" aria-labelledby="note-detail-title">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-700">Selected card</p>
          <h2 className="text-xl font-semibold leading-tight text-slate-900" id="note-detail-title">Loading...</h2>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-4 sm:p-5" aria-labelledby="note-detail-title">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-700">Selected card</p>
          <h2 className="text-xl font-semibold leading-tight text-slate-900" id="note-detail-title">Could not load detail</h2>
        </div>
        <p className="text-sm text-red-700">{error}</p>
      </section>
    );
  }

  if (!note) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-4 sm:p-5" aria-labelledby="note-detail-title">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-700">Selected card</p>
          <h2 className="text-xl font-semibold leading-tight text-slate-900" id="note-detail-title">No card selected</h2>
        </div>
        <p className="text-sm text-slate-500">Save a note or select one from the list to see its details.</p>
      </section>
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
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-col gap-5 sm:p-5" aria-labelledby="note-detail-title">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-bold uppercase tracking-wide text-teal-700">Selected card</p>
        {isEditing ? (
          <input
            aria-label="Note title"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xl font-semibold leading-tight outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10 disabled:opacity-60"
            id="note-detail-title"
            disabled={isSavingMetadata}
            onChange={(event) => {
              setTitleDraft(event.target.value);
              setValidationError(null);
            }}
            value={titleDraft}
          />
        ) : (
          <h2 className="text-xl font-semibold leading-tight text-slate-900" id="note-detail-title">{activeNote.ai_title}</h2>
        )}
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Tags</h3>
          <input
            aria-label="Tags separated by commas"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10 disabled:opacity-60"
            disabled={isSavingMetadata}
            onChange={(event) => setTagsDraft(event.target.value)}
            value={tagsDraft}
          />
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5" aria-label="Tags">
          {activeNote.tags.length > 0 ? (
            activeNote.tags.map((tag) => (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700" key={tag}>
                {tag}
              </span>
            ))
          ) : (
            <span className="rounded-full bg-transparent px-2.5 py-1 text-xs font-semibold text-slate-400">No tags</span>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Summary</h3>
        {isEditing ? (
          <textarea
            aria-label="Note summary"
            className="min-h-24 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-700 focus:ring-4 focus:ring-teal-700/10 disabled:opacity-60"
            disabled={isSavingMetadata}
            onChange={(event) => {
              setSummaryDraft(event.target.value);
              setValidationError(null);
            }}
            value={summaryDraft}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{activeNote.short_summary}</p>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold text-slate-900">Original text</h3>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
          {activeNote.original_text}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-4 border-t border-slate-200 pt-4">
        <div>
          <dt className="text-xs font-bold uppercase text-slate-500">Date added</dt>
          <dd className="mt-0.5 overflow-wrap-anywhere text-sm text-slate-900">{activeNote.date_added}</dd>
        </div>
        <div>
          <dt className="text-xs font-bold uppercase text-slate-500">Updated</dt>
          <dd className="mt-0.5 overflow-wrap-anywhere text-sm text-slate-900">{activeNote.updated_at}</dd>
        </div>
      </dl>

      {isEditing ? (
        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60" disabled={!canSave} onClick={handleSave} type="button">
            {isSavingMetadata ? "Saving..." : "Save"}
          </button>
          <button
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            disabled={actionsDisabled}
            onClick={handleCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
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
            Edit metadata
          </button>
          <button
            className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60"
            disabled={actionsDisabled}
            onClick={() => void onDelete(activeNote.id)}
            type="button"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      )}

      {validationError ? <p className="text-sm text-red-700">{validationError}</p> : null}
      {saveError ? <p className="text-sm text-red-700">{saveError}</p> : null}
      {deleteError ? <p className="text-sm text-red-700">{deleteError}</p> : null}
    </section>
  );
}
