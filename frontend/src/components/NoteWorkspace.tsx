import type { ReactNode, RefObject } from "react";

import type { Category, Note, NoteUpdate } from "../types";
import { AddNote } from "./AddNote";
import type { MarkdownPaneHandle } from "./MarkdownPane";
import { NoteDetail } from "./NoteDetail";

export type NoteWorkspaceMode = "new" | "read-selected" | "edit-selected";

type NoteWorkspaceProps = {
  mode: NoteWorkspaceMode;
  toolbarControls: ReactNode;

  captureRef: RefObject<MarkdownPaneHandle | null>;
  categories: Category[];
  draftText: string;
  isSaving: boolean;
  saveError: string | null;
  onDraftTextChange: (value: string) => void;
  onSave: () => void;
  readMode: boolean;

  note: Note | null;
  isLoading: boolean;
  error: string | null;
  onNewNote: () => void;
  onDelete: (noteId: number) => Promise<void>;
  isDeleting: boolean;
  deleteError: string | null;
  onEdit: () => void;
  onCancelEdit: () => void;
  onCreateCategoryName: (name: string) => Promise<Category>;
  onRegenerateDetails: (bodyText: string) => Promise<{
    ai_title: string;
    short_summary: string;
    tags: string[];
  }>;
  onSaveEdit: (
    body: Required<
      Pick<NoteUpdate, "original_text" | "ai_title" | "short_summary" | "tags" | "category_id">
    > &
      Pick<NoteUpdate, "ai_organization_completed">,
  ) => Promise<void>;
  isSavingEdit: boolean;
  editError: string | null;
  onEditDirtyChange: (isDirty: boolean) => void;
  editResetKey: number;
  surfaceRef?: RefObject<HTMLDivElement | null>;
};

export function NoteWorkspace({
  mode,
  toolbarControls,
  captureRef,
  categories,
  draftText,
  isSaving,
  saveError,
  onDraftTextChange,
  onSave,
  readMode,
  note,
  isLoading,
  error,
  onNewNote,
  onDelete,
  isDeleting,
  deleteError,
  onEdit,
  onCancelEdit,
  onCreateCategoryName,
  onSaveEdit,
  onRegenerateDetails,
  isSavingEdit,
  editError,
  onEditDirtyChange,
  editResetKey,
  surfaceRef,
}: NoteWorkspaceProps) {
  if (mode === "new") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <AddNote
          captureRef={captureRef}
          categories={categories}
          draftText={draftText}
          error={saveError}
          isSaving={isSaving}
          onDraftTextChange={onDraftTextChange}
          onSave={onSave}
          readMode={readMode}
          surfaceRef={surfaceRef}
          toolbarControls={toolbarControls}
        />
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <NoteDetail
        categories={categories}
        deleteError={deleteError}
        editError={editError}
        error={error}
        isDeleting={isDeleting}
        isLoading={isLoading}
        isSavingEdit={isSavingEdit}
        key={`${note?.id ?? "none"}:${note?.updated_at ?? "none"}:${mode}:${editResetKey}`}
        mode={mode}
        note={note}
        onCancelEdit={onCancelEdit}
        onCreateCategoryName={onCreateCategoryName}
        onDelete={onDelete}
        onEdit={onEdit}
        onEditDirtyChange={onEditDirtyChange}
        onRegenerateDetails={onRegenerateDetails}
        onNewNote={onNewNote}
        onSaveEdit={onSaveEdit}
        readMode={readMode}
        surfaceRef={surfaceRef}
        toolbarControls={toolbarControls}
      />
    </div>
  );
}
