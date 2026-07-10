import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { SearchResults, type SearchResultsProps } from "./SearchResults";
import type { SearchResult } from "../../types";

afterEach(cleanup);

const result: SearchResult = {
  id: 10,
  ai_title: "Matching note",
  short_summary: "A matching summary.",
  tags: ["one", "two", "three", "four"],
  date_added: "2026-07-03T00:00:00Z",
  category: null,
  score: 1,
  match_type: "exact",
  matched_snippet: "matching words",
};

function createProps(overrides: Partial<SearchResultsProps> = {}): SearchResultsProps {
  return {
    error: null,
    isActive: true,
    isNoteSelected: () => true,
    isSearching: false,
    onNoteSelect: vi.fn(),
    onToggleNoteScope: vi.fn(),
    results: [result],
    selectedNoteId: null,
    ...overrides,
  };
}

describe("SearchResults", () => {
  test("renders result cards and forwards note and Ask selection", () => {
    const onNoteSelect = vi.fn();
    const onToggleNoteScope = vi.fn();
    render(<SearchResults {...createProps({ onNoteSelect, onToggleNoteScope })} />);

    expect(screen.getByText("Matched: \"matching words\"")).toBeInTheDocument();
    expect(screen.getByText("Exact")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Matching note/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Matching note for Ask" }));
    expect(onNoteSelect).toHaveBeenCalledWith(10);
    expect(onToggleNoteScope).toHaveBeenCalledWith(10);
  });

  test("renders loading, error, and no-match states with existing copy", () => {
    const { rerender } = render(<SearchResults {...createProps({ isSearching: true, results: [] })} />);
    expect(screen.getByText("Bun is searching…")).toBeInTheDocument();

    rerender(<SearchResults {...createProps({ error: "Search unavailable", results: [] })} />);
    expect(screen.getByText("Search unavailable")).toHaveClass("text-error");

    rerender(<SearchResults {...createProps({ results: [] })} />);
    expect(screen.getByText("No matching notes")).toBeInTheDocument();
    expect(screen.getByText("Try another phrase or browse your notebook index.")).toBeInTheDocument();
  });

  test("renders nothing before a search becomes active", () => {
    const { container } = render(<SearchResults {...createProps({ isActive: false })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
