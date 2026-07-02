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
        deleteError={deleteError}
        error={error}
        isDeleting={isDeleting}
        isLoading={isLoading}
        note={note}
        onDelete={onDelete}
        onNewNote={onNewNote}
      />
    </div>
  );
}
