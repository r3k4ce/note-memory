import type { LucideIcon } from "lucide-react";
import type { DragEvent } from "react";
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
  icon?: LucideIcon;
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
};

const MATCH_TYPE_LABELS: Record<NonNullable<NoteCardSearchMetadata["match_type"]>, string> = {
  exact: "Exact",
  fuzzy: "Fuzzy",
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
  icon: Icon,
  draggable = false,
  onDragStart,
  onDragEnd,
}: NoteCardProps) {
  const matchedSnippet = note.matched_snippet?.trim();
  const matchTypeLabel = note.match_type ? MATCH_TYPE_LABELS[note.match_type] : null;
  const askScopeCheckbox = showAskScopeCheckbox ? (
    <input
      aria-label={`Use ${note.ai_title} for Ask`}
      checked={askScopeSelected}
        className="absolute right-3 top-3 h-4 w-4 rounded border-border bg-surface accent-accent opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
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
          aria-selected={selected}
          className="surface-card note-slip group flex w-full items-center gap-2 px-4 py-3 pr-9 text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 hover:shadow-elevated"
          draggable={draggable}
          onClick={() => onSelect(note.id)}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          type="button"
        >
          {Icon ? (
            <Icon
              aria-hidden="true"
              className={`shrink-0 ${selected ? "text-accent" : "text-text-muted"}`}
              size={15}
              strokeWidth={2}
            />
          ) : null}
          <span
            className={`min-w-0 flex-1 truncate text-[14px] font-medium ${
              selected ? "text-accent" : "text-text-primary"
            }`}
          >
            {note.ai_title}
          </span>
          <time className="shrink-0 tabular-nums text-[12px] text-text-muted" dateTime={note.date_added}>
            {note.date_added.slice(5, 10)}
          </time>
        </button>
        {askScopeCheckbox}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        aria-selected={selected}
        className="surface-card note-slip group w-full p-4 pr-10 text-left transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 hover:shadow-elevated"
        onClick={() => onSelect(note.id)}
        type="button"
      >
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-[15px] font-medium ${
              selected ? "text-accent" : "text-text-primary"
            }`}
          >
            {note.ai_title}
          </span>
          <time
            className="shrink-0 text-[12px] tabular-nums text-text-muted"
            dateTime={note.date_added}
          >
            {note.date_added.slice(5, 10)}
          </time>
        </div>
        <p className="mb-1.5 line-clamp-2 text-sm leading-relaxed text-text-secondary">
          {note.short_summary}
        </p>
        {matchedSnippet ? (
          <p className="mb-1.5 line-clamp-1 text-[12px] leading-snug text-text-muted">
            Matched: &quot;{matchedSnippet}&quot;
          </p>
        ) : null}
        <div className="flex flex-wrap gap-1" aria-label="Metadata">
          {matchTypeLabel ? (
            <span className="rounded bg-accent-muted px-2 py-0.5 text-[11px] font-medium text-accent">
              {matchTypeLabel}
            </span>
          ) : null}
          {note.category ? (
            <span className="rounded bg-surface px-2 py-0.5 text-[11px] font-medium text-text-secondary">
              {note.category.name}
            </span>
          ) : null}
          {note.tags.slice(0, 3).map((tag) => (
            <span
              className="rounded bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted"
              key={tag}
            >
              {tag}
            </span>
          ))}
          {note.tags.length > 3 ? (
            <span className="rounded bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted">
              +{note.tags.length - 3}
            </span>
          ) : null}
        </div>
      </button>
      {askScopeCheckbox}
    </div>
  );
}
