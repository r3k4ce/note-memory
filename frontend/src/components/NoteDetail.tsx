import { useEffect, useMemo, useState, type ReactNode } from "react";
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
import { NoteToolbar, TOOLBAR_ACCENT_BUTTON_CLASS, TOOLBAR_BUTTON_CLASS } from "./NoteToolbar";
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
  toolbarControls: ReactNode;
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
  toolbarControls,
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
          Opening your note...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 py-20">
        <p className="text-sm font-medium text-text-primary">Couldn't open this note</p>
        <p className="text-xs text-error">{error}</p>
      </div>
    );
  }

  if (!note) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 py-20">
        <p className="text-sm font-medium text-text-secondary">Pick a note to start reading</p>
        <p className="text-xs text-text-muted">Choose a note from the sidebar, or start a new one.</p>
      </div>
    );
  }

  const actionsDisabled = isDeleting || isSavingEdit || isRegeneratingDetails;
  const parsedDocument = parseNoteEditorDocument(documentText, note, categories);
  const previewBody = readMode ? parsedDocument.update.original_text : "";
  const currentError = validationError ?? editError ?? deleteError;

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
      setValidationError(error instanceof Error ? error.message : "Couldn't refresh the details.");
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
      <NoteToolbar
        actions={
          readMode ? null : (
            <>
              <button
                aria-label={isRegeneratingDetails ? "Regenerating details" : "Regenerate details"}
                className={TOOLBAR_BUTTON_CLASS}
                disabled={actionsDisabled || !onRegenerateDetails}
                onClick={() => void handleRegenerateDetails()}
                title={isRegeneratingDetails ? "Regenerating details" : "Regenerate details"}
                type="button"
              >
                <RefreshCw aria-hidden="true" size={15} strokeWidth={2} />
              </button>
              <button
                aria-label={isSavingEdit ? "Saving changes" : "Save changes"}
                className={TOOLBAR_ACCENT_BUTTON_CLASS}
                disabled={actionsDisabled}
                onClick={() => void handleSaveEdit()}
                title={isSavingEdit ? "Saving changes" : "Save changes"}
                type="button"
              >
                <Save aria-hidden="true" size={15} strokeWidth={2} />
              </button>
              <button
                aria-label="Cancel edit"
                className={TOOLBAR_BUTTON_CLASS}
                disabled={actionsDisabled}
                onClick={onCancelEdit}
                title="Cancel edit"
                type="button"
              >
                <X aria-hidden="true" size={15} strokeWidth={2} />
              </button>
              <button
                aria-label="New note"
                className={TOOLBAR_BUTTON_CLASS}
                disabled={actionsDisabled}
                onClick={onNewNote}
                title="New note"
                type="button"
              >
                <Plus aria-hidden="true" size={15} strokeWidth={2} />
              </button>
              <button
                aria-label={isDeleting ? "Deleting note" : "Delete note"}
                className={`${TOOLBAR_BUTTON_CLASS} border border-error/20 text-error hover:bg-error-muted hover:text-error`}
                disabled={actionsDisabled}
                onClick={() => void onDelete(note.id)}
                title={isDeleting ? "Deleting note" : "Delete note"}
                type="button"
              >
                <Trash2 aria-hidden="true" size={15} strokeWidth={2} />
              </button>
            </>
          )
        }
        error={currentError}
        status={
          readMode ? null : (
            <>
            <span className="truncate text-sm tabular-nums text-text-muted">
              {parsedDocument.update.original_text.trim()
                ? `${parsedDocument.update.original_text.length} chars`
                : "Empty note"}
            </span>
            <span className="rounded-md bg-surface-raised px-2 py-0.5 text-sm font-medium text-text-muted">
              {parsedDocument.categoryNameToCreate ?? note.category?.name ?? "Uncategorized"}
            </span>
            </>
          )
        }
        toolbarControls={toolbarControls}
      />

      {readMode ? (
        <details className="note-details mx-5 mt-3 shrink-0 text-sm text-text-secondary">
          <summary>Details</summary>
          <div className="note-details-body">
            <p className="whitespace-pre-wrap leading-relaxed">{parsedDocument.update.short_summary}</p>
            {parsedDocument.update.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Tags">
                {parsedDocument.update.tags.map((tag) => (
                  <span className="note-tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {readMode ? (
        <div className="flex min-h-0 flex-1 flex-col">
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
