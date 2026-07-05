import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Save, Trash2, X } from "lucide-react";

import {
  getNoteEditorBody,
  parseNoteEditorDocument,
  serializeNoteEditorDocument,
  updateNoteEditorDocumentMetadata,
} from "../editor/noteEditorDocument";
import type { Category, Note, OrganizedNoteMetadata } from "../types";
import { MarkdownPane } from "./MarkdownPane";
import { MarkdownPreview } from "./MarkdownPreview";
import type { NoteWorkspaceMode } from "./NoteWorkspace";

type NoteDetailProps = {
  categories: Category[];
  deleteError: string | null;
  editError: string | null;
  error: string | null;
  isDeleting: boolean;
  isLoading: boolean;
  isSavingEdit: boolean;
  mode: NoteWorkspaceMode;
  note: Note | null;
  onCancelEdit: () => void;
  onCreateCategoryName?: (name: string) => Promise<Category>;
  onDelete: (noteId: number) => Promise<void>;
  onEdit: () => void;
  onEditDirtyChange: (isDirty: boolean) => void;
  onNewNote: () => void;
  onRegenerateDetails?: (bodyText: string) => Promise<OrganizedNoteMetadata>;
  onSaveEdit: (body: {
    original_text: string;
    ai_title: string;
    short_summary: string;
    tags: string[];
    category_id: number | null;
  }) => Promise<void>;
  readMode?: boolean;
};

function noteToDocument(note: Note): string {
  return serializeNoteEditorDocument(note);
}

function updatesMatchNote(
  update: {
    original_text: string;
    ai_title: string;
    short_summary: string;
    tags: string[];
    category_id: number | null;
  },
  note: Note,
): boolean {
  return (
    update.original_text === note.original_text &&
    update.ai_title === note.ai_title &&
    update.short_summary === note.short_summary &&
    update.category_id === (note.category?.id ?? null) &&
    update.tags.length === note.tags.length &&
    update.tags.every((tag, index) => tag === note.tags[index])
  );
}

export function NoteDetail({
  categories,
  deleteError,
  editError,
  error,
  isDeleting,
  isLoading,
  isSavingEdit,
  mode,
  note,
  onCancelEdit,
  onCreateCategoryName,
  onDelete,
  onEditDirtyChange,
  onNewNote,
  onRegenerateDetails,
  onSaveEdit,
  readMode = false,
}: NoteDetailProps) {
  const [documentText, setDocumentText] = useState(() => (note ? noteToDocument(note) : ""));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isRegeneratingDetails, setIsRegeneratingDetails] = useState(false);

  const editIsDirty = useMemo(() => {
    if (!note || mode !== "edit-selected") {
      return false;
    }

    const parsed = parseNoteEditorDocument(documentText, note, categories);
    return parsed.categoryNameToCreate !== null || !updatesMatchNote(parsed.update, note);
  }, [categories, documentText, mode, note]);

  useEffect(() => {
    onEditDirtyChange(editIsDirty);
  }, [editIsDirty, onEditDirtyChange]);

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
        <p className="text-sm font-medium text-text-secondary">No note selected</p>
        <p className="text-xs text-text-muted">Select a note from the list, or start a new note.</p>
      </div>
    );
  }

  const actionsDisabled = isDeleting || isSavingEdit || isRegeneratingDetails;
  const parsedDocument = parseNoteEditorDocument(documentText, note, categories);
  const previewBody = readMode ? parsedDocument.update.original_text : "";

  async function handleRegenerateDetails() {
    if (!note || !onRegenerateDetails) {
      return;
    }

    const bodyText = getNoteEditorBody(documentText);
    if (!bodyText.trim()) {
      setValidationError("Body cannot be blank.");
      return;
    }

    setIsRegeneratingDetails(true);
    setValidationError(null);
    try {
      const metadata = await onRegenerateDetails(bodyText);
      setDocumentText(updateNoteEditorDocumentMetadata(documentText, note, metadata));
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : "Could not regenerate details.");
    } finally {
      setIsRegeneratingDetails(false);
    }
  }

  async function handleSaveEdit() {
    if (!note) {
      return;
    }

    const parsed = parseNoteEditorDocument(documentText, note, categories);
    if (!parsed.update.original_text.trim()) {
      setValidationError("Body cannot be blank.");
      return;
    }

    if (parsed.update.tags.length > 10) {
      setValidationError("Use 10 tags or fewer.");
      return;
    }

    let categoryId = parsed.update.category_id;
    if (parsed.categoryNameToCreate) {
      if (!onCreateCategoryName) {
        setValidationError(`Category "${parsed.categoryNameToCreate}" does not exist.`);
        return;
      }

      const createdCategory = await onCreateCategoryName(parsed.categoryNameToCreate);
      categoryId = createdCategory.id;
    }

    setValidationError(null);
    await onSaveEdit({ ...parsed.update, category_id: categoryId });
  }

  return (
    <article className="flex h-full min-h-0 w-full flex-col">
      <header className="flex shrink-0 flex-col gap-2 px-5 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-[11px] text-text-muted">
              {parsedDocument.update.original_text.trim()
                ? `${parsedDocument.update.original_text.length} chars`
                : "Empty note"}
            </span>
            <span className="rounded bg-surface px-2 py-0.5 text-[11px] text-text-secondary">
              {parsedDocument.categoryNameToCreate ?? note.category?.name ?? "Uncategorized"}
            </span>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <button
              aria-label={isRegeneratingDetails ? "Regenerating details" : "Regenerate details"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface disabled:opacity-40"
              disabled={actionsDisabled || !onRegenerateDetails || readMode}
              onClick={() => void handleRegenerateDetails()}
              title={isRegeneratingDetails ? "Regenerating details" : "Regenerate details"}
              type="button"
            >
              <RefreshCw size={14} strokeWidth={2} />
            </button>
            <button
              aria-label={isSavingEdit ? "Saving changes" : "Save changes"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              disabled={actionsDisabled || readMode}
              onClick={() => void handleSaveEdit()}
              title={isSavingEdit ? "Saving changes" : "Save changes"}
              type="button"
            >
              <Save size={14} strokeWidth={2} />
            </button>
            <button
              aria-label="Cancel edit"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface disabled:opacity-40"
              disabled={actionsDisabled}
              onClick={onCancelEdit}
              title="Cancel edit"
              type="button"
            >
              <X size={14} strokeWidth={2} />
            </button>
            <button
              aria-label="New note"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface disabled:opacity-40"
              disabled={actionsDisabled}
              onClick={onNewNote}
              title="New note"
              type="button"
            >
              <Plus size={14} strokeWidth={2} />
            </button>
            <button
              aria-label={isDeleting ? "Deleting note" : "Delete note"}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-error/20 text-error transition-colors hover:bg-error-muted disabled:opacity-40"
              disabled={actionsDisabled}
              onClick={() => void onDelete(note.id)}
              title={isDeleting ? "Deleting note" : "Delete note"}
              type="button"
            >
              <Trash2 size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {readMode ? <details className="rounded-md bg-surface px-3 py-2 text-sm text-text-secondary">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-text-muted">
            Details
          </summary>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{parsedDocument.update.short_summary}</p>
          {parsedDocument.update.tags.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Tags">
              {parsedDocument.update.tags.map((tag) => (
                <span className="rounded bg-bg px-2 py-0.5 text-[11px] font-medium text-text-secondary" key={tag}>
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </details> : null}

        {validationError ? <p className="text-xs text-error">{validationError}</p> : null}
        {editError ? <p className="text-xs text-error">{editError}</p> : null}
        {deleteError ? <p className="text-xs text-error">{deleteError}</p> : null}
      </header>

      {readMode ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <MarkdownPreview source={previewBody} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <MarkdownPane
            categoryNames={categories.map((category) => category.name)}
            disabled={isSavingEdit || isRegeneratingDetails}
            id="edit-note-body"
            mode="edit"
            onChange={(value) => {
              setDocumentText(value);
              setValidationError(null);
            }}
            value={documentText}
            variant="workspace"
          />
        </div>
      )}
    </article>
  );
}
