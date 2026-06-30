import type { Note } from "../types";

type NoteDetailProps = {
  note: Note;
};

export function NoteDetail({ note }: NoteDetailProps) {
  return (
    <section className="detail-panel" aria-labelledby="note-detail-title">
      <div className="detail-header">
        <p className="eyebrow">Selected note</p>
        <h2 id="note-detail-title">{note.ai_title}</h2>
      </div>

      <div className="detail-section">
        <h3>Original text</h3>
        <p>{note.original_text}</p>
      </div>

      <div className="detail-section">
        <h3>Summary</h3>
        <p>{note.short_summary}</p>
      </div>

      <div className="tag-row" aria-label="Tags">
        {note.tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>

      <dl className="metadata-list">
        <div>
          <dt>Created</dt>
          <dd>{note.date_added}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{note.updated_at}</dd>
        </div>
      </dl>
    </section>
  );
}
