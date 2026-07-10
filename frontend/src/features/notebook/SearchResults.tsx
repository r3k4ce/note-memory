import { NoteCard } from "../../components/NoteCard";
import type { SearchResult } from "../../types";

export type SearchResultsProps = {
  error: string | null;
  isActive: boolean;
  isNoteSelected: (noteId: number) => boolean;
  isSearching: boolean;
  onNoteSelect: (noteId: number) => void;
  onToggleNoteScope: (noteId: number) => void;
  results: SearchResult[];
  selectedNoteId: number | null;
};

export function SearchResults({
  error,
  isActive,
  isNoteSelected,
  isSearching,
  onNoteSelect,
  onToggleNoteScope,
  results,
  selectedNoteId,
}: SearchResultsProps) {
  if (!isActive && !isSearching && !error) {
    return null;
  }

  return (
    <>
      {isSearching ? (
        <div className="flex items-center gap-2 px-2 py-3 text-xs text-text-muted">
          <div className="h-3 w-3 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
          Bun is searching…
        </div>
      ) : null}

      {error ? <p className="px-2 py-3 text-xs text-error">{error}</p> : null}

      {isActive && !isSearching && !error && results.length === 0 ? (
        <div className="mx-1.5 rounded-lg bg-surface p-4 text-center">
          <p className="text-sm font-medium text-text-secondary">No matching notes</p>
          <p className="mt-1 text-xs text-text-muted">
            Try another phrase or browse your notebook index.
          </p>
        </div>
      ) : null}

      {isActive ? (
        <div className="flex flex-col gap-2">
          {results.map((note) => (
            <NoteCard
              askScopeSelected={isNoteSelected(note.id)}
              key={note.id}
              mode="search"
              note={note}
              onAskScopeToggle={onToggleNoteScope}
              onSelect={onNoteSelect}
              selected={note.id === selectedNoteId}
              showAskScopeCheckbox
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
