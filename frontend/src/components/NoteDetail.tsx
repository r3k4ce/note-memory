import { useState } from "react";

import type { Note, NoteMetadataUpdate } from "../types";

type NoteDetailProps = {
  deleteError: string | null;
  error: string | null;
  isDeleting: boolean;
  isLoading: boolean;
  isSavingMetadata: boolean;
  note: Note | null;
  onDelete: (noteId: number) => Promise<void>;
  onSaveMetadata: (noteId: number, metadata: NoteMetadataUpdate) => Promise<void>;
  saveError: string | null;
};

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function tagsMatch(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

export function NoteDetail({
  deleteError,
  error,
  isDeleting,
  isLoading,
  isSavingMetadata,
  note,
  onDelete,
  onSaveMetadata,
  saveError,
}: NoteDetailProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <section className="detail-panel" aria-labelledby="note-detail-title">
        <div className="detail-header">
          <p className="eyebrow">Selected note</p>
          <h2 id="note-detail-title">Loading note...</h2>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="detail-panel" aria-labelledby="note-detail-title">
        <div className="detail-header">
          <p className="eyebrow">Selected note</p>
          <h2 id="note-detail-title">Could not load detail</h2>
        </div>
        <p className="error-message">{error}</p>
      </section>
    );
  }

  if (!note) {
    return (
      <section className="detail-panel" aria-labelledby="note-detail-title">
        <div className="detail-header">
          <p className="eyebrow">Selected note</p>
          <h2 id="note-detail-title">No note selected</h2>
        </div>
        <p className="muted-copy">Save a note or select one from the list to see its details.</p>
      </section>
    );
  }

  const activeNote = note;
  const title = titleDraft.trim();
  const summary = summaryDraft.trim();
  const tags = parseTags(tagsDraft);
  const hasChanges =
    activeNote.ai_title !== title ||
    activeNote.short_summary !== summary ||
    !tagsMatch(activeNote.tags, tags);
  const canSave = Boolean(title && summary && hasChanges && !isSavingMetadata);
  const actionsDisabled = isSavingMetadata || isDeleting;

  async function handleSave() {
    if (!title || !summary) {
      setValidationError("Title and summary cannot be blank.");
      return;
    }

    setValidationError(null);

    try {
      await onSaveMetadata(activeNote.id, {
        ai_title: title,
        short_summary: summary,
        tags,
      });
      setIsEditing(false);
    } catch {
      // Keep the draft open; App renders the API error.
    }
  }

  function handleCancel() {
    setIsEditing(false);
    setValidationError(null);
    setTitleDraft(activeNote.ai_title);
    setSummaryDraft(activeNote.short_summary);
    setTagsDraft(activeNote.tags.join(", "));
  }

  return (
    <section className="detail-panel" aria-labelledby="note-detail-title">
      <div className="detail-header">
        <p className="eyebrow">Selected note</p>
        {isEditing ? (
          <input
            aria-label="Note title"
            className="field"
            id="note-detail-title"
            disabled={isSavingMetadata}
            onChange={(event) => {
              setTitleDraft(event.target.value);
              setValidationError(null);
            }}
            value={titleDraft}
          />
        ) : (
          <h2 id="note-detail-title">{activeNote.ai_title}</h2>
        )}
      </div>

      <div className="detail-section">
        <h3>Summary</h3>
        {isEditing ? (
          <textarea
            aria-label="Note summary"
            className="field field-textarea"
            disabled={isSavingMetadata}
            onChange={(event) => {
              setSummaryDraft(event.target.value);
              setValidationError(null);
            }}
            value={summaryDraft}
          />
        ) : (
          <p>{activeNote.short_summary}</p>
        )}
      </div>

      {isEditing ? (
        <div className="detail-section">
          <h3>Tags</h3>
          <input
            aria-label="Tags separated by commas"
            className="field"
            disabled={isSavingMetadata}
            onChange={(event) => setTagsDraft(event.target.value)}
            value={tagsDraft}
          />
        </div>
      ) : (
        <div className="tag-row" aria-label="Tags">
          {activeNote.tags.length > 0 ? (
            activeNote.tags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))
          ) : (
            <span className="tag tag-muted">No tags</span>
          )}
        </div>
      )}

      {isEditing ? (
        <div className="button-row">
          <button className="button" disabled={!canSave} onClick={handleSave} type="button">
            {isSavingMetadata ? "Saving..." : "Save"}
          </button>
          <button
            className="button button-secondary"
            disabled={actionsDisabled}
            onClick={handleCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="button-row">
          <button
            className="button button-secondary"
            disabled={actionsDisabled}
            onClick={() => {
              setTitleDraft(activeNote.ai_title);
              setSummaryDraft(activeNote.short_summary);
              setTagsDraft(activeNote.tags.join(", "));
              setValidationError(null);
              setIsEditing(true);
            }}
            type="button"
          >
            Edit metadata
          </button>
          <button
            className="button button-danger"
            disabled={actionsDisabled}
            onClick={() => void onDelete(activeNote.id)}
            type="button"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      )}

      {validationError ? <p className="error-message">{validationError}</p> : null}
      {saveError ? <p className="error-message">{saveError}</p> : null}
      {deleteError ? <p className="error-message">{deleteError}</p> : null}

      <dl className="metadata-list">
        <div>
          <dt>Date added</dt>
          <dd>{activeNote.date_added}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{activeNote.updated_at}</dd>
        </div>
      </dl>

      <div className="detail-section">
        <h3>Original text</h3>
        <p className="original-text">{activeNote.original_text}</p>
      </div>
    </section>
  );
}
