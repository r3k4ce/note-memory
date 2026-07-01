import { Search, X } from "lucide-react";
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
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form onSubmit={handleSubmit} role="search" className="relative">
      <Search
        size={14}
        strokeWidth={2}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
      />
      <input
        aria-label="Search notes"
        className="w-full rounded-md border border-border bg-surface-raised py-1.5 pl-8 pr-8 text-[13px] text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
        onChange={(event) => onChange(event.target.value)}
        placeholder={isSearching ? "Searching..." : "Search notes..."}
        ref={searchRef}
        type="search"
        value={query}
      />
      {query || isSearching ? (
        <button
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted transition-colors hover:text-text-secondary"
          onClick={onClear}
          type="button"
        >
          <X size={14} strokeWidth={2} />
        </button>
      ) : null}
    </form>
  );
}
