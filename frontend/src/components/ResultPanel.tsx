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
      <div className="flex flex-col gap-4" aria-live="polite">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-accent">Ask</p>
          <h2 className="text-xl font-semibold leading-tight text-text-primary">Answer</h2>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
          {visibleAskResult.answer}
        </p>
        {visibleAskResult.sources.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-slate-200 pt-3" aria-label="Supporting sources">
            <p className="text-xs font-bold uppercase tracking-wide text-text-muted">Sources</p>
            {visibleAskResult.sources.map((source) => (
              <article
                className="rounded-lg border border-slate-200 bg-white p-3 flex flex-col gap-1"
                key={source.note_id}
              >
                <h3 className="text-sm font-semibold text-text-primary">{source.title}</h3>
                <time className="text-xs text-text-caption" dateTime={source.date_added}>
                  {source.date_added}
                </time>
              </article>
            ))}
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
