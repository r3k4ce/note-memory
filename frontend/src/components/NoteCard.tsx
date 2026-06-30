import type { Note } from "../types";

type NoteCardProps = {
  note: Note;
  selected?: boolean;
  onSelect: (noteId: number) => void;
};

export function NoteCard({ note, selected = false, onSelect }: NoteCardProps) {
  return (
    <button
      className={selected ? "note-card note-card-selected" : "note-card"}
      onClick={() => onSelect(note.id)}
      type="button"
    >
      <span>
        <span className="note-card-title">{note.ai_title}</span>
        <span className="note-card-summary">{note.short_summary}</span>
      </span>
      <span className="tag-row" aria-label="Tags">
        {note.tags.length > 0 ? (
          note.tags.map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))
        ) : (
          <span className="tag tag-muted">No tags</span>
        )}
      </span>
      <time dateTime={note.date_added}>{note.date_added}</time>
    </button>
  );
}
