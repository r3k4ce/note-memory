import type { FormEvent } from "react";

type SearchBarProps = {
  isSearching: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
  onSubmit: () => void;
  query: string;
};

export function SearchBar({ isSearching, onChange, onClear, onSubmit, query }: SearchBarProps) {
  const trimmedQuery = query.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="tool-panel" aria-labelledby="search-title" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <p className="eyebrow">Find</p>
        <h2 id="search-title">Search</h2>
      </div>
      <input
        aria-label="Search notes"
        className="field"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search notes..."
        type="search"
        value={query}
      />
      <div className="button-row">
        <button className="button" disabled={isSearching || !trimmedQuery} type="submit">
          {isSearching ? "Searching..." : "Search"}
        </button>
        {query || isSearching ? (
          <button className="button button-secondary" onClick={onClear} type="button">
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}
