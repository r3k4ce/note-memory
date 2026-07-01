import type { Category, Note, NoteUpdate } from "../types";
import { NoteDetail } from "./NoteDetail";

type ResultPanelProps = {
  note: Note | null;
  categories: Category[];
  isLoading: boolean;
  error: string | null;
  onDelete: (noteId: number) => Promise<void>;
  isDeleting: boolean;
  deleteError: string | null;
  onSaveMetadata: (noteId: number, metadata: NoteUpdate) => Promise<void>;
  isSavingMetadata: boolean;
  saveError: string | null;
};

export function ResultPanel({
  note,
  categories,
  isLoading,
  error,
  onDelete,
  isDeleting,
  deleteError,
  onSaveMetadata,
  isSavingMetadata,
  saveError,
}: ResultPanelProps) {
  return (
    <NoteDetail
      categories={categories}
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
