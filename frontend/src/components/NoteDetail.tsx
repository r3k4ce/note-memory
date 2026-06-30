import type { Note } from "../types";

type NoteDetailProps = {
  error: string | null;
  isLoading: boolean;
  note: Note | null;
};

export function NoteDetail({ error, isLoading, note }: NoteDetailProps) {
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

  return (
    <section className="detail-panel" aria-labelledby="note-detail-title">
      <div className="detail-header">
        <p className="eyebrow">Selected note</p>
        <h2 id="note-detail-title">{note.ai_title}</h2>
      </div>

      <div className="detail-section">
        <h3>Summary</h3>
        <p>{note.short_summary}</p>
      </div>

      <div className="tag-row" aria-label="Tags">
        {note.tags.length > 0 ? (
          note.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))
        ) : (
          <span className="tag tag-muted">No tags</span>
        )}
      </div>

      <dl className="metadata-list">
        <div>
          <dt>Date added</dt>
          <dd>{note.date_added}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{note.updated_at}</dd>
        </div>
      </dl>

      <div className="detail-section">
        <h3>Original text</h3>
        <p className="original-text">{note.original_text}</p>
      </div>
    </section>
  );
}
