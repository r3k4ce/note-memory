import type { FormEvent, RefObject } from "react";

type SearchBarProps = {
  isSearching: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
};

export function SearchBar({ isSearching, onChange, onClear, onSubmit, query, searchRef }: SearchBarProps) {
  const trimmedQuery = query.trim();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-center"
      aria-labelledby="search-title"
      onSubmit={handleSubmit}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">Find</p>
        <h2 className="text-base font-semibold text-text-primary" id="search-title">
          Search mapping memory
        </h2>
      </div>
      <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <input
          aria-label="Search notes"
          className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base outline-none focus:border-brand focus:ring-4 focus:ring-brand/10 disabled:opacity-60"
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search mapping memory..."
          ref={searchRef}
          type="search"
          value={query}
        />
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            disabled={isSearching || !trimmedQuery}
            type="submit"
          >
            {isSearching ? "Searching memory..." : "Search"}
          </button>
          {query || isSearching ? (
            <button
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-slate-50 transition-colors"
              onClick={onClear}
              type="button"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
