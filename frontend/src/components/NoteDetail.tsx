import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";

import type { Category, Note } from "../types";
import { MarkdownPane } from "./MarkdownPane";
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
  onDelete: (noteId: number) => Promise<void>;
  onEdit: () => void;
  onEditDirtyChange: (isDirty: boolean) => void;
  onNewNote: () => void;
  onSaveEdit: (body: {
    original_text: string;
    ai_title: string;
    short_summary: string;
    tags: string[];
    category_id: number | null;
  }) => Promise<void>;
};

type EditDraft = {
  bodyText: string;
  title: string;
  summary: string;
  tagsText: string;
  categoryId: number | null;
};

function noteToDraft(note: Note): EditDraft {
  return {
    bodyText: note.original_text,
    title: note.ai_title,
    summary: note.short_summary,
    tagsText: note.tags.join(", "),
    categoryId: note.category?.id ?? null,
  };
}

function parseTags(tagsText: string): string[] {
  const tags: string[] = [];
  const seenTags = new Set<string>();

  for (const tag of tagsText.split(",")) {
    const normalizedTag = tag.trim().toLowerCase();
    if (!normalizedTag || seenTags.has(normalizedTag)) {
      continue;
    }

    tags.push(normalizedTag);
    seenTags.add(normalizedTag);
  }

  return tags;
}

function draftsMatchNote(draft: EditDraft, note: Note): boolean {
  const draftTags = parseTags(draft.tagsText);

  return (
    draft.bodyText === note.original_text &&
    draft.title === note.ai_title &&
    draft.summary === note.short_summary &&
    draft.categoryId === (note.category?.id ?? null) &&
    draftTags.length === note.tags.length &&
    draftTags.every((tag, index) => tag === note.tags[index])
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
  onDelete,
  onEdit,
  onEditDirtyChange,
  onNewNote,
  onSaveEdit,
}: NoteDetailProps) {
  const [editDraft, setEditDraft] = useState<EditDraft>(() =>
    note
      ? noteToDraft(note)
      : {
          bodyText: "",
          title: "",
          summary: "",
          tagsText: "",
          categoryId: null,
        },
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const editIsDirty = useMemo(() => {
    if (!note || mode !== "edit-selected") {
      return false;
    }

    return !draftsMatchNote(editDraft, note);
  }, [editDraft, mode, note]);

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
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-surface">
          <Pencil size={18} strokeWidth={1.5} className="text-text-muted" />
        </div>
        <p className="text-sm font-medium text-text-secondary">No note selected</p>
        <p className="text-xs text-text-muted">Select a note from the list, or start a new note.</p>
      </div>
    );
  }

  const isEditing = mode === "edit-selected";
  const actionsDisabled = isDeleting || isSavingEdit;

  async function handleSaveEdit() {
    if (!note) {
      return;
    }

    const title = editDraft.title.trim();
    const summary = editDraft.summary.trim();
    const tags = parseTags(editDraft.tagsText);
    const bodyText = editDraft.bodyText;

    if (!title) {
      setValidationError("Title cannot be blank.");
      return;
    }

    if (!summary) {
      setValidationError("Summary cannot be blank.");
      return;
    }

    if (!bodyText.trim()) {
      setValidationError("Body cannot be blank.");
      return;
    }

    if (tags.length > 10) {
      setValidationError("Use 10 tags or fewer.");
      return;
    }

    setValidationError(null);
    await onSaveEdit({
      original_text: bodyText,
      ai_title: title,
      short_summary: summary,
      tags,
      category_id: editDraft.categoryId,
    });
  }

  return (
    <article className={isEditing ? "mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-4" : "mx-auto flex h-full max-w-3xl flex-col gap-6 py-2"}>
      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {isEditing ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor="edit-note-title">
                  Title
                </label>
                <input
                  className="rounded-md border border-border bg-surface px-3 py-2 text-xl font-semibold leading-tight text-text-primary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
                  disabled={isSavingEdit}
                  id="edit-note-title"
                  onChange={(event) => {
                    setEditDraft({ ...editDraft, title: event.target.value });
                    setValidationError(null);
                  }}
                  value={editDraft.title}
                />
              </div>
            ) : (
              <h2 className="text-xl font-semibold leading-tight text-text-primary">{note.ai_title}</h2>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            {isEditing ? (
              <>
                <button
                  aria-label={isSavingEdit ? "Saving changes" : "Save changes"}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={actionsDisabled}
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
              </>
            ) : (
              <button
                aria-label="Edit note"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface disabled:opacity-40"
                disabled={actionsDisabled}
                onClick={onEdit}
                title="Edit note"
                type="button"
              >
                <Pencil size={14} strokeWidth={2} />
              </button>
            )}
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

        {!isEditing ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-text-muted">
            <span className="rounded bg-surface px-2 py-0.5 text-text-secondary">
              {note.category?.name ?? "Uncategorized"}
            </span>
            <time dateTime={note.date_added}>Created {note.date_added}</time>
            <time dateTime={note.updated_at}>Updated {note.updated_at}</time>
            {note.tags.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1.5" aria-label="Tags">
                {note.tags.map((tag) => (
                  <span
                    className="rounded bg-surface px-2 py-0.5 font-medium text-text-secondary"
                    key={tag}
                  >
                    {tag}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-text-muted">
            {categories.length > 0 ? (
              <label className="flex items-center gap-1.5">
                <span className="sr-only">Category</span>
                <select
                  className="rounded border border-border bg-surface px-2 py-0.5 text-text-secondary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
                  disabled={isSavingEdit}
                  id="edit-note-category"
                  onChange={(event) =>
                    setEditDraft({ ...editDraft, categoryId: event.target.value ? Number(event.target.value) : null })
                  }
                  value={editDraft.categoryId ?? ""}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <time dateTime={note.date_added}>Created {note.date_added}</time>
            <time dateTime={note.updated_at}>Updated {note.updated_at}</time>
            <label className="min-w-40 flex-1">
              <span className="sr-only">Tags</span>
              <input
                className="w-full rounded border border-border bg-surface px-2 py-0.5 font-medium text-text-secondary outline-none transition-colors placeholder:text-text-muted focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
                disabled={isSavingEdit}
                id="edit-note-tags"
                onChange={(event) => {
                  setEditDraft({ ...editDraft, tagsText: event.target.value });
                  setValidationError(null);
                }}
                placeholder="routing, memory, labels"
                value={editDraft.tagsText}
              />
            </label>
          </div>
        )}
        {validationError ? <p className="text-xs text-error">{validationError}</p> : null}
        {editError ? <p className="text-xs text-error">{editError}</p> : null}
        {deleteError ? <p className="text-xs text-error">{deleteError}</p> : null}
      </header>

      {!isEditing ? (
        <details className="rounded-md bg-surface px-3 py-2 text-sm text-text-secondary">
          <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wide text-text-muted">
            Summary
          </summary>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{note.short_summary}</p>
        </details>
      ) : null}

      {!isEditing ? (
        <div className="flex flex-col gap-2">
          <MarkdownPane mode="read" value={note.original_text} />
        </div>
      ) : null}

      {isEditing ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor="edit-note-summary">
            Summary
          </label>
          <textarea
            className="min-h-28 resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
            disabled={isSavingEdit}
            id="edit-note-summary"
            onChange={(event) => {
              setEditDraft({ ...editDraft, summary: event.target.value });
              setValidationError(null);
            }}
            value={editDraft.summary}
          />
        </div>
      ) : null}

      {isEditing ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor="edit-note-body">
            Original text
          </label>
          <MarkdownPane
            disabled={isSavingEdit}
            id="edit-note-body"
            mode="edit"
            onChange={(value) => {
              setEditDraft({ ...editDraft, bodyText: value });
              setValidationError(null);
            }}
            value={editDraft.bodyText}
            variant="workspace"
          />
        </div>
      ) : null}
    </article>
  );
}
