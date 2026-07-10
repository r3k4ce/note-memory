import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { searchNotes } from "../../api";
import type { Category, Note, SearchResult } from "../../types";
import { useSearchController } from "./useSearchController";

vi.mock("../../api", () => ({
  searchNotes: vi.fn(),
}));

const workCategory: Category = {
  id: 1,
  name: "Work",
  slug: "work",
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

const personalCategory: Category = {
  id: 2,
  name: "Personal",
  slug: "personal",
  created_at: "2026-07-02T00:00:00Z",
  updated_at: "2026-07-02T00:00:00Z",
};

const workResult: SearchResult = {
  id: 10,
  ai_title: "Work note",
  short_summary: "A note about work.",
  tags: ["work"],
  date_added: "2026-07-03T00:00:00Z",
  category: workCategory,
  score: 0.82,
  match_type: "fuzzy",
  matched_snippet: "Work note",
};

const personalResult: SearchResult = {
  id: 11,
  ai_title: "Personal note",
  short_summary: "A note about personal plans.",
  tags: ["personal"],
  date_added: "2026-07-04T00:00:00Z",
  category: personalCategory,
  score: 0.75,
  match_type: "exact",
  matched_snippet: "Personal note",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function submitResults(
  result: ReturnType<typeof renderHook<ReturnType<typeof useSearchController>, unknown>>["result"],
  results: SearchResult[],
) {
  vi.mocked(searchNotes).mockResolvedValueOnce(results);
  act(() => result.current.onQueryChange("notes"));
  await act(() => result.current.submit());
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useSearchController", () => {
  test("debounces live text search for 300 ms and disables semantic search", async () => {
    vi.useFakeTimers();
    vi.mocked(searchNotes).mockResolvedValue([workResult]);
    const { result } = renderHook(() => useSearchController());

    act(() => result.current.onQueryChange("  work  "));

    expect(result.current.query).toBe("  work  ");
    expect(result.current.activeQuery).toBe("work");
    expect(result.current.isSearching).toBe(true);
    expect(searchNotes).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(299));
    expect(searchNotes).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));

    expect(searchNotes).toHaveBeenCalledWith("work", { semantic: false });
    expect(result.current.results).toEqual([workResult]);
    expect(result.current.isSearching).toBe(false);
  });

  test("submits an immediate full semantic search and cancels the pending live search", async () => {
    vi.useFakeTimers();
    vi.mocked(searchNotes).mockResolvedValue([workResult]);
    const { result } = renderHook(() => useSearchController());

    act(() => result.current.onQueryChange("work"));
    await act(() => result.current.submit());
    await act(async () => vi.advanceTimersByTime(300));

    expect(searchNotes).toHaveBeenCalledTimes(1);
    expect(searchNotes).toHaveBeenCalledWith("work");
    expect(result.current.results).toEqual([workResult]);
  });

  test("pauses and resumes the pending live search without clearing its query", async () => {
    vi.useFakeTimers();
    vi.mocked(searchNotes).mockResolvedValue([workResult]);
    const { result } = renderHook(() => useSearchController());

    act(() => result.current.onQueryChange("work"));
    act(() => result.current.pauseLiveSearch());
    await act(async () => vi.advanceTimersByTime(300));

    expect(searchNotes).not.toHaveBeenCalled();
    expect(result.current.query).toBe("work");
    expect(result.current.activeQuery).toBe("work");

    act(() => result.current.resumeLiveSearch());
    await act(async () => vi.advanceTimersByTime(299));
    expect(searchNotes).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(searchNotes).toHaveBeenCalledWith("work", { semantic: false });
    expect(result.current.results).toEqual([workResult]);
  });

  test("prevents stale responses from replacing the latest search state", async () => {
    vi.useFakeTimers();
    const firstSearch = deferred<SearchResult[]>();
    const secondSearch = deferred<SearchResult[]>();
    vi.mocked(searchNotes)
      .mockReturnValueOnce(firstSearch.promise)
      .mockReturnValueOnce(secondSearch.promise);
    const { result } = renderHook(() => useSearchController());

    act(() => result.current.onQueryChange("work"));
    await act(async () => vi.advanceTimersByTime(300));
    act(() => result.current.onQueryChange("personal"));
    await act(async () => vi.advanceTimersByTime(300));

    await act(async () => firstSearch.resolve([workResult]));
    expect(result.current.results).toEqual([]);
    expect(result.current.isSearching).toBe(true);

    await act(async () => secondSearch.resolve([personalResult]));
    expect(result.current.results).toEqual([personalResult]);
    expect(result.current.activeQuery).toBe("personal");
    expect(result.current.isSearching).toBe(false);
  });

  test("reports the active request error and clears prior results", async () => {
    const { result } = renderHook(() => useSearchController());
    await submitResults(result, [workResult]);
    vi.mocked(searchNotes).mockRejectedValueOnce(new Error("Search service unavailable."));

    act(() => result.current.onQueryChange("broken"));
    await act(() => result.current.submit());

    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBe("Search service unavailable.");
    expect(result.current.isSearching).toBe(false);
  });

  test("blank input and clear cancel pending work and reset all search state", async () => {
    vi.useFakeTimers();
    const search = deferred<SearchResult[]>();
    vi.mocked(searchNotes).mockReturnValueOnce(search.promise);
    const { result } = renderHook(() => useSearchController());

    act(() => result.current.onQueryChange("work"));
    await act(async () => vi.advanceTimersByTime(300));
    act(() => result.current.onQueryChange("   "));
    await act(async () => search.resolve([workResult]));

    expect(result.current.query).toBe("   ");
    expect(result.current.activeQuery).toBeNull();
    expect(result.current.results).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isSearching).toBe(false);

    act(() => result.current.onQueryChange("personal"));
    act(() => result.current.clear());
    await act(async () => vi.advanceTimersByTime(300));

    expect(result.current.query).toBe("");
    expect(result.current.activeQuery).toBeNull();
    expect(searchNotes).toHaveBeenCalledTimes(1);
  });

  test("replaces matching note data while preserving search match metadata", async () => {
    const { result } = renderHook(() => useSearchController());
    await submitResults(result, [workResult]);
    const savedNote: Note = {
      id: workResult.id,
      original_text: "Updated body",
      ai_title: "Updated work note",
      short_summary: "Updated summary.",
      tags: ["updated"],
      date_added: workResult.date_added,
      updated_at: "2026-07-05T00:00:00Z",
      category: personalCategory,
      needs_ai_organization: false,
    };

    act(() => result.current.replaceNote(savedNote));

    expect(result.current.results).toEqual([
      {
        ...workResult,
        ai_title: "Updated work note",
        short_summary: "Updated summary.",
        tags: ["updated"],
        category: personalCategory,
      },
    ]);
  });

  test("renames category metadata in matching results", async () => {
    const { result } = renderHook(() => useSearchController());
    await submitResults(result, [workResult, personalResult]);
    const renamedCategory = { ...workCategory, name: "Projects", slug: "projects" };

    act(() => result.current.renameCategory(renamedCategory));

    expect(result.current.results[0].category).toEqual(renamedCategory);
    expect(result.current.results[1].category).toEqual(personalCategory);
  });

  test("deletes result note IDs", async () => {
    const { result } = renderHook(() => useSearchController());
    await submitResults(result, [workResult, personalResult]);

    act(() => result.current.deleteNotes([10]));

    expect(result.current.results).toEqual([personalResult]);
  });

  test("uncategorizes result note IDs", async () => {
    const { result } = renderHook(() => useSearchController());
    await submitResults(result, [workResult, personalResult]);

    act(() => result.current.uncategorizeNotes([10]));

    expect(result.current.results[0].category).toBeNull();
    expect(result.current.results[1].category).toEqual(personalCategory);
  });
});
