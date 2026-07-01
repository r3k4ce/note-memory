import type { NoteCardData } from "../types";

type NoteCardProps = {
  note: NoteCardData;
  selected?: boolean;
  onSelect: (noteId: number) => void;
};

export function NoteCard({ note, selected = false, onSelect }: NoteCardProps) {
  return (
    <button
      className={`group w-full rounded-md border p-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
        selected
          ? "border-border-strong bg-surface-hover"
          : "border-transparent hover:bg-surface-hover"
      }`}
      onClick={() => onSelect(note.id)}
      type="button"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span
          className={`truncate text-[13px] font-medium ${
            selected ? "text-accent" : "text-text-primary"
          }`}
        >
          {note.ai_title}
        </span>
        <time
          className="shrink-0 text-[10px] tabular-nums text-text-muted"
          dateTime={note.date_added}
        >
          {note.date_added.slice(5, 10)}
        </time>
      </div>
      <p className="mb-1.5 line-clamp-2 text-xs leading-relaxed text-text-secondary">
        {note.short_summary}
      </p>
      <div className="flex flex-wrap gap-1" aria-label="Metadata">
        {note.category ? (
          <span className="rounded border border-border bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
            {note.category.name}
          </span>
        ) : null}
        {note.tags.slice(0, 3).map((tag) => (
          <span
            className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-text-muted"
            key={tag}
          >
            {tag}
          </span>
        ))}
        {note.tags.length > 3 ? (
          <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
            +{note.tags.length - 3}
          </span>
        ) : null}
      </div>
    </button>
  );
}
