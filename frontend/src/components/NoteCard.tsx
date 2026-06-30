import type { Note } from "../types";

type NoteCardProps = {
  note: Note;
  selected?: boolean;
};

export function NoteCard({ note, selected = false }: NoteCardProps) {
  return (
    <article className={selected ? "note-card note-card-selected" : "note-card"}>
      <div>
        <h3>{note.ai_title}</h3>
        <p>{note.short_summary}</p>
      </div>
      <div className="tag-row" aria-label="Tags">
        {note.tags.map((tag) => (
          <span className="tag" key={tag}>
            {tag}
          </span>
        ))}
      </div>
      <time dateTime={note.date_added}>{note.date_added}</time>
    </article>
  );
}
