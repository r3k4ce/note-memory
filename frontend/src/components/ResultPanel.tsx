import type { Note } from "../types";
import { NoteDetail } from "./NoteDetail";

type ResultPanelProps = {
  note: Note | null;
  isLoading: boolean;
  error: string | null;
  onNewNote: () => void;
  onDelete: (noteId: number) => Promise<void>;
  isDeleting: boolean;
  deleteError: string | null;
};

export function ResultPanel({
  note,
  isLoading,
  error,
  onNewNote,
  onDelete,
  isDeleting,
  deleteError,
}: ResultPanelProps) {
  return (
    <NoteDetail
      deleteError={deleteError}
      error={error}
      isDeleting={isDeleting}
      isLoading={isLoading}
      note={note}
      onDelete={onDelete}
      onNewNote={onNewNote}
    />
  );
}
