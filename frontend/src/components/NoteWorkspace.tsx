import type { RefObject } from "react";

import type { Category, Note } from "../types";
import { AddNote } from "./AddNote";
import { ResultPanel } from "./ResultPanel";

export type NoteWorkspaceMode = "new" | "read-selected" | "edit-selected";

type NoteWorkspaceProps = {
  mode: NoteWorkspaceMode;

  captureRef: RefObject<HTMLTextAreaElement | null>;
  categories: Category[];
  draftCategoryId: number | null;
  draftText: string;
  isSaving: boolean;
  saveError: string | null;
  onDraftCategoryChange: (categoryId: number | null) => void;
  onDraftTextChange: (value: string) => void;
  onSave: () => void;

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
    ai_title: string;
    short_summary: string;
    tags: string[];
    category_id: number | null;
  }) => Promise<void>;
  isSavingEdit: boolean;
  editError: string | null;
  onEditDirtyChange: (isDirty: boolean) => void;
};

export function NoteWorkspace({
  mode,
  captureRef,
  categories,
  draftCategoryId,
  draftText,
  isSaving,
  saveError,
  onDraftCategoryChange,
  onDraftTextChange,
  onSave,
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
}: NoteWorkspaceProps) {
  if (mode === "new") {
    return (
      <div className="mx-auto max-w-3xl px-6 py-6">
        <AddNote
          captureRef={captureRef}
          categories={categories}
          draftText={draftText}
          error={saveError}
          isSaving={isSaving}
          onCategoryChange={onDraftCategoryChange}
          onDraftTextChange={onDraftTextChange}
          onSave={onSave}
          selectedCategoryId={draftCategoryId}
        />
      </div>
    );
  }

  return (
    <div className="px-6 py-6">
      <ResultPanel
        categories={categories}
        deleteError={deleteError}
        editError={editError}
        error={error}
        isDeleting={isDeleting}
        isLoading={isLoading}
        isSavingEdit={isSavingEdit}
        mode={mode}
        note={note}
        onCancelEdit={onCancelEdit}
        onDelete={onDelete}
        onEdit={onEdit}
        onEditDirtyChange={onEditDirtyChange}
        onNewNote={onNewNote}
        onSaveEdit={onSaveEdit}
      />
    </div>
  );
}
