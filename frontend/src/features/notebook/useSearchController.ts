import { useCallback, useEffect, useRef, useState } from "react";

import { searchNotes } from "../../api";
import type { Category, NoteCardData, SearchResult } from "../../types";

const LIVE_SEARCH_DELAY_MS = 300;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Couldn't search your notes.";
}

export function useSearchController() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryRef = useRef("");
  const requestIdRef = useRef(0);
  const liveSearchTimeoutIdRef = useRef<number | null>(null);

  const cancelLiveSearch = useCallback(() => {
    if (liveSearchTimeoutIdRef.current !== null) {
      window.clearTimeout(liveSearchTimeoutIdRef.current);
      liveSearchTimeoutIdRef.current = null;
    }
  }, []);

  const invalidateRequests = useCallback(() => {
    requestIdRef.current += 1;
    cancelLiveSearch();
    return requestIdRef.current;
  }, [cancelLiveSearch]);

  const resetSearchState = useCallback(() => {
    setActiveQuery(null);
    setResults([]);
    setError(null);
    setIsSearching(false);
  }, []);

  const runSearch = useCallback(async (
    searchQuery: string,
    requestId: number,
    live: boolean,
  ) => {
    try {
      const nextResults = live
        ? await searchNotes(searchQuery, { semantic: false })
        : await searchNotes(searchQuery);
      if (requestIdRef.current === requestId) {
        setResults(nextResults);
      }
    } catch (searchError) {
      if (requestIdRef.current === requestId) {
        setResults([]);
        setError(getErrorMessage(searchError));
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setIsSearching(false);
      }
    }
  }, []);

  const scheduleLiveSearch = useCallback((searchQuery: string): void => {
    const requestId = invalidateRequests();
    setActiveQuery(searchQuery);
    setResults([]);
    setError(null);
    setIsSearching(true);
    liveSearchTimeoutIdRef.current = window.setTimeout(() => {
      liveSearchTimeoutIdRef.current = null;
      void runSearch(searchQuery, requestId, true);
    }, LIVE_SEARCH_DELAY_MS);
  }, [invalidateRequests, runSearch]);

  const onQueryChange = useCallback((value: string) => {
    queryRef.current = value;
    setQuery(value);
    const searchQuery = value.trim();

    if (!searchQuery) {
      invalidateRequests();
      resetSearchState();
      return;
    }

    scheduleLiveSearch(searchQuery);
  }, [invalidateRequests, resetSearchState, scheduleLiveSearch]);

  const pauseLiveSearch = useCallback((): void => {
    cancelLiveSearch();
  }, [cancelLiveSearch]);

  const resumeLiveSearch = useCallback((): void => {
    const searchQuery = queryRef.current.trim();
    if (searchQuery) {
      scheduleLiveSearch(searchQuery);
    }
  }, [scheduleLiveSearch]);

  const clear = useCallback(() => {
    queryRef.current = "";
    setQuery("");
    invalidateRequests();
    resetSearchState();
  }, [invalidateRequests, resetSearchState]);

  const submit = useCallback(async () => {
    const searchQuery = queryRef.current.trim();
    if (!searchQuery) {
      clear();
      return;
    }

    const requestId = invalidateRequests();
    setActiveQuery(searchQuery);
    setResults([]);
    setError(null);
    setIsSearching(true);
    await runSearch(searchQuery, requestId, false);
  }, [clear, invalidateRequests, runSearch]);

  const replaceNote = useCallback((note: NoteCardData) => {
    setResults((currentResults) =>
      currentResults.map((result) =>
        result.id === note.id
          ? {
              ...result,
              ai_title: note.ai_title,
              short_summary: note.short_summary,
              tags: note.tags,
              date_added: note.date_added,
              category: note.category,
            }
          : result,
      ),
    );
  }, []);

  const renameCategory = useCallback((category: Category) => {
    setResults((currentResults) =>
      currentResults.map((result) =>
        result.category?.id === category.id ? { ...result, category } : result,
      ),
    );
  }, []);

  const deleteNotes = useCallback((noteIds: readonly number[]) => {
    const deletedNoteIds = new Set(noteIds);
    setResults((currentResults) =>
      currentResults.filter((result) => !deletedNoteIds.has(result.id)),
    );
  }, []);

  const uncategorizeNotes = useCallback((noteIds: readonly number[]) => {
    const uncategorizedNoteIds = new Set(noteIds);
    setResults((currentResults) =>
      currentResults.map((result) =>
        uncategorizedNoteIds.has(result.id) ? { ...result, category: null } : result,
      ),
    );
  }, []);

  useEffect(() => () => {
    requestIdRef.current += 1;
    cancelLiveSearch();
  }, [cancelLiveSearch]);

  return {
    activeQuery,
    clear,
    deleteNotes,
    error,
    isSearching,
    onQueryChange,
    pauseLiveSearch,
    query,
    renameCategory,
    replaceNote,
    results,
    resumeLiveSearch,
    submit,
    uncategorizeNotes,
  };
}
