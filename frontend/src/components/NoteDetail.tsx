import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import type { Note } from "../types";
import { MarkdownPreview } from "./MarkdownPreview";

type NoteDetailProps = {
  deleteError: string | null;
  error: string | null;
  isDeleting: boolean;
  isLoading: boolean;
  note: Note | null;
  onDelete: (noteId: number) => Promise<void>;
  onNewNote: () => void;
};

type SourceView = "preview" | "raw";

export function NoteDetail({
  deleteError,
  error,
  isDeleting,
  isLoading,
  note,
  onDelete,
  onNewNote,
}: NoteDetailProps) {
  const [sourceViewSelection, setSourceViewSelection] = useState<{ noteId: number | null; view: SourceView }>(
    {
      noteId: null,
      view: "preview",
    },
  );

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

  const sourceView = sourceViewSelection.noteId === note.id ? sourceViewSelection.view : "preview";
  const actionsDisabled = isDeleting;

  return (
    <article className="mx-auto flex h-full max-w-3xl flex-col gap-6 py-2">
      <header className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold leading-tight text-text-primary">{note.ai_title}</h2>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
          <time dateTime={note.date_added}>{note.date_added}</time>
          <span className="text-border-strong">·</span>
          <time dateTime={note.updated_at}>updated {note.updated_at}</time>
          {note.category ? (
            <>
              <span className="text-border-strong">·</span>
              <span className="rounded border border-border bg-surface-raised px-2 py-0.5 text-text-secondary">
                {note.category.name}
              </span>
            </>
          ) : null}
        </div>
      </header>

      {note.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Tags">
          {note.tags.map((tag) => (
            <span
              className="rounded border border-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-text-secondary"
              key={tag}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Summary</h3>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{note.short_summary}</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Original text</h3>
          <div className="flex rounded-md border border-border bg-surface p-0.5" role="tablist" aria-label="Original text view">
            {(["preview", "raw"] as const).map((view) => {
              const isActive = sourceView === view;
              return (
                <button
                  aria-selected={isActive}
                  className={`rounded px-2.5 py-1 text-[12px] font-medium capitalize transition-colors ${
                    isActive
                      ? "bg-surface-raised text-text-primary"
                      : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                  }`}
                  key={view}
                  onClick={() => setSourceViewSelection({ noteId: note.id, view })}
                  role="tab"
                  type="button"
                >
                  {view}
                </button>
              );
            })}
          </div>
        </div>
        <div className="rounded-md border border-border bg-surface-raised px-4 py-3">
          {sourceView === "preview" ? (
            <MarkdownPreview source={note.original_text} />
          ) : (
            <div className="font-mono text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap">
              {note.original_text}
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40"
          disabled
          type="button"
        >
          <Pencil size={13} strokeWidth={2} />
          Edit
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40"
          disabled={actionsDisabled}
          onClick={onNewNote}
          type="button"
        >
          <Plus size={13} strokeWidth={2} />
          New note
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-error/20 px-3 py-1.5 text-[13px] font-medium text-error transition-colors hover:bg-error-muted disabled:opacity-40"
          disabled={actionsDisabled}
          onClick={() => void onDelete(note.id)}
          type="button"
        >
          <Trash2 size={13} strokeWidth={2} />
          {isDeleting ? "Deleting..." : "Delete"}
        </button>
      </div>

      {deleteError ? <p className="text-xs text-error">{deleteError}</p> : null}
    </article>
  );
}
