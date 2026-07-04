import type { NoteCardData, SearchResult } from "../types";

type NoteCardSearchMetadata = Partial<Pick<SearchResult, "match_type" | "matched_snippet">>;

type NoteCardProps = {
  askScopeSelected: boolean;
  mode: "browse" | "search";
  note: NoteCardData & NoteCardSearchMetadata;
  onAskScopeToggle: (noteId: number) => void;
  selected?: boolean;
  showAskScopeCheckbox: boolean;
  onSelect: (noteId: number) => void;
};

const MATCH_TYPE_LABELS: Record<NonNullable<NoteCardSearchMetadata["match_type"]>, string> = {
  exact: "Exact",
  semantic: "Semantic",
  hybrid: "Hybrid",
};

export function NoteCard({
  askScopeSelected,
  mode,
  note,
  onAskScopeToggle,
  selected = false,
  showAskScopeCheckbox,
  onSelect,
}: NoteCardProps) {
  const matchedSnippet = note.matched_snippet?.trim();
  const matchTypeLabel = note.match_type ? MATCH_TYPE_LABELS[note.match_type] : null;
  const askScopeCheckbox = showAskScopeCheckbox ? (
    <input
      aria-label={`Use ${note.ai_title} for Ask`}
      checked={askScopeSelected}
      className="absolute right-2.5 top-2.5 h-3 w-3 rounded border-border bg-surface accent-accent opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
      onChange={(event) => {
        event.stopPropagation();
        onAskScopeToggle(note.id);
      }}
      onClick={(event) => event.stopPropagation()}
      type="checkbox"
    />
  ) : null;

  if (mode === "browse") {
    return (
      <div className="relative">
        <button
          className={`group w-full rounded-md p-2 pr-8 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
            selected
              ? "bg-surface"
              : "hover:bg-surface-hover"
          }`}
          onClick={() => onSelect(note.id)}
          type="button"
        >
          <span
            className={`block truncate text-[13px] font-medium ${
              selected ? "text-accent" : "text-text-primary"
            }`}
          >
            {note.ai_title}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-text-muted">
            <time className="shrink-0 tabular-nums" dateTime={note.date_added}>
              {note.date_added.slice(5, 10)}
            </time>
            {note.category ? (
              <span className="truncate text-text-secondary">{note.category.name}</span>
            ) : null}
          </span>
        </button>
        {askScopeCheckbox}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        className={`group w-full rounded-md p-2.5 pr-8 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
          selected
            ? "bg-surface"
            : "hover:bg-surface-hover"
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
        {matchedSnippet ? (
          <p className="mb-1.5 line-clamp-1 text-[11px] leading-snug text-text-muted">
            Matched: &quot;{matchedSnippet}&quot;
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1" aria-label="Metadata">
          {matchTypeLabel ? (
            <span className="rounded bg-accent-muted px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {matchTypeLabel}
            </span>
          ) : null}
          {note.category ? (
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
              {note.category.name}
            </span>
          ) : null}
          {note.tags.slice(0, 3).map((tag) => (
            <span
              className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted"
              key={tag}
            >
              {tag}
            </span>
          ))}
          {note.tags.length > 3 ? (
            <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
              +{note.tags.length - 3}
            </span>
          ) : null}
        </div>
      </button>
      {askScopeCheckbox}
    </div>
  );
}
