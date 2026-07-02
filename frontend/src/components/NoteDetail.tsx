import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";

import type { Category, Note } from "../types";
import type { NoteWorkspaceMode } from "./NoteWorkspace";
import { MarkdownPreview } from "./MarkdownPreview";

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

type SourceView = "preview" | "raw";

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
  const [sourceViewSelection, setSourceViewSelection] = useState<{ noteId: number | null; view: SourceView }>(
    {
      noteId: null,
      view: "preview",
    },
  );
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
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-surface-raised">
          <Pencil size={18} strokeWidth={1.5} className="text-text-muted" />
        </div>
        <p className="text-sm font-medium text-text-secondary">No note selected</p>
        <p className="text-xs text-text-muted">Select a note from the list, or capture a new one.</p>
      </div>
    );
  }

  const sourceView = sourceViewSelection.noteId === note.id ? sourceViewSelection.view : "preview";
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
    <article className="mx-auto flex h-full max-w-3xl flex-col gap-6 py-2">
      <header className="flex flex-col gap-3">
        {isEditing ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor="edit-note-title">
              Title
            </label>
            <input
              className="rounded-md border border-border bg-surface-raised px-3 py-2 text-xl font-semibold leading-tight text-text-primary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
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
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-text-muted">
          <time dateTime={note.date_added}>{note.date_added}</time>
          <span className="text-border-strong">·</span>
          <time dateTime={note.updated_at}>updated {note.updated_at}</time>
          {!isEditing && note.category ? (
            <>
              <span className="text-border-strong">·</span>
              <span className="rounded border border-border bg-surface-raised px-2 py-0.5 text-text-secondary">
                {note.category.name}
              </span>
            </>
          ) : null}
        </div>
      </header>

      {isEditing && categories.length > 0 ? (
        <div className="flex flex-col gap-1.5 sm:max-w-xs">
          <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor="edit-note-category">
            Category
          </label>
          <select
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
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
        </div>
      ) : null}

      {isEditing ? (
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor="edit-note-tags">
            Tags
          </label>
          <input
            className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
            disabled={isSavingEdit}
            id="edit-note-tags"
            onChange={(event) => {
              setEditDraft({ ...editDraft, tagsText: event.target.value });
              setValidationError(null);
            }}
            placeholder="routing, memory, labels"
            value={editDraft.tagsText}
          />
        </div>
      ) : note.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Tags">
          {note.tags.map((tag) => (
            <span
              className="rounded border border-border bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-text-secondary"
              key={tag}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        {isEditing ? (
          <>
            <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor="edit-note-summary">
              Summary
            </label>
            <textarea
              className="min-h-28 resize-y rounded-md border border-border bg-surface-raised px-3 py-2 text-sm leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
              disabled={isSavingEdit}
              id="edit-note-summary"
              onChange={(event) => {
                setEditDraft({ ...editDraft, summary: event.target.value });
                setValidationError(null);
              }}
              value={editDraft.summary}
            />
          </>
        ) : (
          <>
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Summary</h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">{note.short_summary}</p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {isEditing ? (
          <>
            <label className="text-[11px] font-medium uppercase tracking-wide text-text-muted" htmlFor="edit-note-body">
              Original text
            </label>
            <textarea
              className="min-h-72 resize-y rounded-md border border-border bg-surface-raised px-3 py-2 font-mono text-[13px] leading-relaxed text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
              disabled={isSavingEdit}
              id="edit-note-body"
              onChange={(event) => {
                setEditDraft({ ...editDraft, bodyText: event.target.value });
                setValidationError(null);
              }}
              value={editDraft.bodyText}
            />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Original text</h3>
              <div className="flex rounded-md border border-border bg-surface p-0.5" role="tablist" aria-label="Original text view">
                {(["preview", "raw"] as const).map((view) => {
                  const isActive = sourceView === view;
                  return (
                    <button
                      aria-selected={isActive}
                      className={`rounded px-2.5 py-1 text-[12px] font-medium capitalize transition-colors ${
                        isActive
                          ? "bg-surface-raised text-text-primary"
                          : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                      }`}
                      key={view}
                      onClick={() => setSourceViewSelection({ noteId: note.id, view })}
                      role="tab"
                      type="button"
                    >
                      {view}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="rounded-md border border-border bg-surface-raised px-4 py-3">
              {sourceView === "preview" ? (
                <MarkdownPreview source={note.original_text} />
              ) : (
                <div className="font-mono text-[13px] leading-relaxed text-text-secondary whitespace-pre-wrap">
                  {note.original_text}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {isEditing ? (
          <>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              disabled={actionsDisabled}
              onClick={() => void handleSaveEdit()}
              type="button"
            >
              <Save size={13} strokeWidth={2} />
              {isSavingEdit ? "Saving..." : "Save changes"}
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40"
              disabled={actionsDisabled}
              onClick={onCancelEdit}
              type="button"
            >
              <X size={13} strokeWidth={2} />
              Cancel
            </button>
          </>
        ) : (
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40"
            disabled={actionsDisabled}
            onClick={onEdit}
            type="button"
          >
            <Pencil size={13} strokeWidth={2} />
            Edit
          </button>
        )}
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-40"
          disabled={actionsDisabled}
          onClick={onNewNote}
          type="button"
        >
          <Plus size={13} strokeWidth={2} />
          New note
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-error/20 px-3 py-1.5 text-[13px] font-medium text-error transition-colors hover:bg-error-muted disabled:opacity-40"
          disabled={actionsDisabled}
          onClick={() => void onDelete(note.id)}
          type="button"
        >
          <Trash2 size={13} strokeWidth={2} />
          {isDeleting ? "Deleting..." : "Delete"}
        </button>
      </div>

      {validationError ? <p className="text-xs text-error">{validationError}</p> : null}
      {editError ? <p className="text-xs text-error">{editError}</p> : null}
      {deleteError ? <p className="text-xs text-error">{deleteError}</p> : null}
    </article>
  );
}
