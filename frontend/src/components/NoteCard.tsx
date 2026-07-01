import type { NoteCardData } from "../types";

type NoteCardProps = {
  note: NoteCardData;
  selected?: boolean;
  onSelect: (noteId: number) => void;
};

export function NoteCard({ note, selected = false, onSelect }: NoteCardProps) {
  return (
    <button
      className={`w-full rounded-xl border bg-white p-3 text-left transition-colors cursor-pointer focus:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/10 sm:p-4 flex flex-col gap-2 ${
        selected
          ? "border-teal-700 ring-2 ring-teal-700/30 bg-teal-50/40"
          : "border-slate-200 hover:border-teal-700/40 hover:bg-slate-50"
      }`}
      onClick={() => onSelect(note.id)}
      type="button"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-slate-900">{note.ai_title}</span>
        <time className="shrink-0 text-xs text-slate-500" dateTime={note.date_added}>{note.date_added}</time>
      </div>
      <span className="line-clamp-2 text-sm leading-snug text-slate-600">{note.short_summary}</span>
      <span className="flex flex-wrap gap-1.5" aria-label="Tags">
        {note.tags.length > 0 ? (
          note.tags.map((tag) => (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700" key={tag}>
              {tag}
            </span>
          ))
        ) : (
          <span className="rounded-full bg-transparent px-2.5 py-1 text-xs font-semibold text-slate-400">No tags</span>
        )}
      </span>
    </button>
  );
}
