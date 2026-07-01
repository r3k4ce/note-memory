import { Sparkles } from "lucide-react";
import type { Note, NoteMetadataUpdate } from "../types";
import { NoteDetail } from "./NoteDetail";
import type { AskResponse } from "../types";

type ResultPanelProps = {
  note: Note | null;
  isLoading: boolean;
  error: string | null;
  onDelete: (noteId: number) => Promise<void>;
  isDeleting: boolean;
  deleteError: string | null;
  onSaveMetadata: (noteId: number, metadata: NoteMetadataUpdate) => Promise<void>;
  isSavingMetadata: boolean;
  saveError: string | null;
  askResult: AskResponse | null;
  deletedNoteId: number | null;
};

export function ResultPanel({
  note,
  isLoading,
  error,
  onDelete,
  isDeleting,
  deleteError,
  onSaveMetadata,
  isSavingMetadata,
  saveError,
  askResult,
  deletedNoteId,
}: ResultPanelProps) {
  const visibleAskResult =
    deletedNoteId !== null && askResult?.sources.some((source) => source.note_id === deletedNoteId)
      ? null
      : askResult;

  if (visibleAskResult) {
    return (
      <div className="mx-auto flex h-full max-w-3xl flex-col gap-5 py-2" aria-live="polite">
        <header className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-muted">
            <Sparkles size={13} strokeWidth={2} className="text-accent" />
          </div>
          <h2 className="text-sm font-semibold text-text-primary">Answer</h2>
        </header>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
          {visibleAskResult.answer}
        </p>
        {visibleAskResult.sources.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border pt-4" aria-label="Supporting sources">
            <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
              Sources · {visibleAskResult.sources.length}
            </p>
            <div className="flex flex-col gap-1.5">
              {visibleAskResult.sources.map((source) => (
                <article
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-raised px-3 py-2"
                  key={source.note_id}
                >
                  <h3 className="text-[13px] font-medium text-text-secondary">{source.title}</h3>
                  <time className="shrink-0 text-[10px] tabular-nums text-text-muted" dateTime={source.date_added}>
                    {source.date_added.slice(0, 10)}
                  </time>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <NoteDetail
      deleteError={deleteError}
      error={error}
      isDeleting={isDeleting}
      isLoading={isLoading}
      isSavingMetadata={isSavingMetadata}
      note={note}
      onDelete={onDelete}
      onSaveMetadata={onSaveMetadata}
      saveError={saveError}
    />
  );
}
