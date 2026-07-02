import type { Category, Note } from "../types";
import type { NoteWorkspaceMode } from "./NoteWorkspace";
import { NoteDetail } from "./NoteDetail";

type ResultPanelProps = {
  mode: NoteWorkspaceMode;
  categories: Category[];
  note: Note | null;
  isLoading: boolean;
  error: string | null;
  onNewNote: () => void;
  onDelete: (noteId: number) => Promise<void>;
  isDeleting: boolean;
  deleteError: string | null;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (body: {
    original_text: string;
    ai_title: string;
    short_summary: string;
    tags: string[];
    category_id: number | null;
  }) => Promise<void>;
  isSavingEdit: boolean;
  editError: string | null;
  onEditDirtyChange: (isDirty: boolean) => void;
};

export function ResultPanel({
  mode,
  categories,
  note,
  isLoading,
  error,
  onNewNote,
  onDelete,
  isDeleting,
  deleteError,
  onEdit,
  onCancelEdit,
  onSaveEdit,
  isSavingEdit,
  editError,
  onEditDirtyChange,
}: ResultPanelProps) {
  return (
    <NoteDetail
      categories={categories}
      deleteError={deleteError}
      editError={editError}
      error={error}
      isDeleting={isDeleting}
      isLoading={isLoading}
      isSavingEdit={isSavingEdit}
      key={`${note?.id ?? "none"}:${mode}`}
      mode={mode}
      note={note}
      onCancelEdit={onCancelEdit}
      onDelete={onDelete}
      onEdit={onEdit}
      onEditDirtyChange={onEditDirtyChange}
      onNewNote={onNewNote}
      onSaveEdit={onSaveEdit}
    />
  );
}
