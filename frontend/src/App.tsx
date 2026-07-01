import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  createCategory,
  createNote,
  deleteNote,
  getNote,
  listCategories,
  listNotes,
  searchNotes,
  updateNoteMetadata,
} from "./api";
import { CommandCenter } from "./components/CommandCenter";
import { NoteCard } from "./components/NoteCard";
import { ResultPanel } from "./components/ResultPanel";
import { SearchBar } from "./components/SearchBar";
import { SegmentedControl } from "./components/SegmentedControl";
import { APP_SHORTCUTS, useKeyboardShortcuts, type AppMode } from "./hooks/useKeyboardShortcuts";
import type {
  AskResponse,
  Category,
  CategoryScopeRequest,
  Note,
  NoteCardData,
  NoteMetadataUpdate,
  SearchResult,
} from "./types";

type CategoryFilter = "all" | "uncategorized" | number;

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function filterNotesByCategory(notes: Note[], filter: CategoryFilter): Note[] {
  if (filter === "all") {
    return notes;
  }

  if (filter === "uncategorized") {
    return notes.filter((note) => note.category === null);
  }

  return notes.filter((note) => note.category?.id === filter);
}

function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id - right.id,
  );
}

function categoryFilterScope(filter: CategoryFilter): CategoryScopeRequest {
  if (filter === "uncategorized") {
    return { uncategorized: true };
  }

  if (typeof filter === "number") {
    return { category_id: filter };
  }

  return {};
}

function categoryFilterScopeKey(filter: CategoryFilter): string {
  if (filter === "uncategorized") {
    return "uncategorized";
  }

  if (typeof filter === "number") {
    return `category:${filter}`;
  }

  return "all";
}

function categoryFilterLabel(filter: CategoryFilter, categories: Category[]): string {
  if (filter === "all") {
    return "All notes";
  }

  if (filter === "uncategorized") {
    return "Uncategorized";
  }

  return categories.find((category) => category.id === filter)?.name ?? "Category";
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<CategoryFilter>("all");
  const [draftText, setDraftText] = useState("");
  const [draftCategoryId, setDraftCategoryId] = useState<number | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [searchText, setSearchText] = useState("");
  const [activeSearchQuery, setActiveSearchQuery] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [metadataSaveError, setMetadataSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [lastDeletedNoteId, setLastDeletedNoteId] = useState<number | null>(null);

  const [mode, setMode] = useState<AppMode>("capture");
  const [askResult, setAskResult] = useState<AskResponse | null>(null);

  const searchRequestId = useRef(0);
  const captureRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);

  const categoryScope = categoryFilterScope(selectedCategoryFilter);
  const categoryScopeKey = categoryFilterScopeKey(selectedCategoryFilter);
  const categoryScopeLabel = categoryFilterLabel(selectedCategoryFilter, categories);
  const isSearchActive = activeSearchQuery !== null;
  const categoryFilteredNotes = filterNotesByCategory(notes, selectedCategoryFilter);
  const visibleNotes: NoteCardData[] = isSearchActive ? searchResults : categoryFilteredNotes;

  const hasSetInitialMode = useRef(false);

  useKeyboardShortcuts(setMode, { captureRef, searchRef, askRef });

  useEffect(() => {
    if (!hasSetInitialMode.current && !isLoadingNotes && notes.length > 0) {
      hasSetInitialMode.current = true;
      setMode("search");
    }
  }, [isLoadingNotes, notes.length]);

  const selectNote = useCallback((noteId: number) => {
    setSelectedNoteId(noteId);
  }, []);

  const clearSearch = useCallback(() => {
    searchRequestId.current += 1;
    setSearchText("");
    setActiveSearchQuery(null);
    setSearchResults([]);
    setSearchError(null);
    setIsSearching(false);
  }, []);

  const handleCategoryFilterChange = useCallback(
    (filter: CategoryFilter) => {
      clearSearch();
      setAskResult(null);
      setSelectedCategoryFilter(filter);
      setCategoryError(null);
      if (typeof filter === "number") {
        setDraftCategoryId(filter);
      } else if (filter === "uncategorized") {
        setDraftCategoryId(null);
      }

      const filteredNotes = filterNotesByCategory(notes, filter);
      setSelectedNoteId(filteredNotes[0]?.id ?? null);
      if (filteredNotes.length === 0) {
        setSelectedNote(null);
      }
    },
    [clearSearch, notes],
  );

  const handleSearchTextChange = useCallback((value: string) => {
    setSearchText(value);

    if (!value.trim()) {
      searchRequestId.current += 1;
      setActiveSearchQuery(null);
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadInitialData() {
      setIsLoadingNotes(true);
      setListError(null);
      setCategoryError(null);

      try {
        const [loadedNotes, loadedCategories] = await Promise.all([listNotes(), listCategories()]);
        if (ignore) {
          return;
        }

        setNotes(loadedNotes);
        setCategories(loadedCategories);
        setSelectedNoteId(loadedNotes[0]?.id ?? null);
      } catch (error) {
        if (ignore) {
          return;
        }

        setListError(getErrorMessage(error, "Could not load notes."));
        setNotes([]);
        setCategories([]);
        setSelectedNoteId(null);
        setSelectedNote(null);
      } finally {
        if (!ignore) {
          setIsLoadingNotes(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (selectedNoteId === null) {
      return;
    }

    const noteId = selectedNoteId;
    let ignore = false;

    async function loadSelectedNote() {
      setIsLoadingDetail(true);
      setDetailError(null);
      setMetadataSaveError(null);
      setDeleteError(null);

      try {
        const loadedNote = await getNote(noteId);
        if (!ignore) {
          setSelectedNote(loadedNote);
        }
      } catch (error) {
        if (!ignore) {
          setSelectedNote(null);
          setDetailError(getErrorMessage(error, "Could not load note detail."));
        }
      } finally {
        if (!ignore) {
          setIsLoadingDetail(false);
        }
      }
    }

    void loadSelectedNote();

    return () => {
      ignore = true;
    };
  }, [selectedNoteId]);

  async function handleSearchSubmit() {
    const query = searchText.trim();
    if (!query) {
      clearSearch();
      return;
    }

    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    setActiveSearchQuery(query);
    setSearchResults([]);
    setSearchError(null);
    setIsSearching(true);

    try {
      const results = await searchNotes(query, categoryScope);
      if (searchRequestId.current === requestId) {
        setSearchResults(results);
      }
    } catch (error) {
      if (searchRequestId.current === requestId) {
        setSearchResults([]);
        setSearchError(getErrorMessage(error, "Could not search notes."));
      }
    } finally {
      if (searchRequestId.current === requestId) {
        setIsSearching(false);
      }
    }
  }

  async function handleCreateCategory(event: FormEvent) {
    event.preventDefault();

    const name = categoryDraft.trim();
    if (!name) {
      setCategoryError("Enter a category name.");
      return;
    }

    setIsSavingCategory(true);
    setCategoryError(null);

    try {
      const category = await createCategory(name);
      setCategories((currentCategories) => sortCategories([...currentCategories, category]));
      setCategoryDraft("");
      setIsCreatingCategory(false);
      setSelectedCategoryFilter(category.id);
      setDraftCategoryId(category.id);
      setSelectedNote(null);
      setSelectedNoteId(null);
    } catch (error) {
      setCategoryError(getErrorMessage(error, "Could not create category."));
    } finally {
      setIsSavingCategory(false);
    }
  }

  async function handleSaveNote() {
    if (!draftText.trim()) {
      setSaveError("Enter note text before saving.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const savedNote = await createNote(draftText, draftCategoryId);
      clearSearch();
      setNotes((currentNotes) => [savedNote, ...currentNotes.filter((note) => note.id !== savedNote.id)]);
      setDraftText("");
      setSelectedNote(savedNote);
      setSelectedNoteId(savedNote.id);
      setMode("search");
    } catch (error) {
      setSaveError(getErrorMessage(error, "Could not save note."));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUpdateNoteMetadata(noteId: number, body: NoteMetadataUpdate) {
    setIsSavingMetadata(true);
    setMetadataSaveError(null);

    try {
      const updatedNote = await updateNoteMetadata(noteId, body);
      setSelectedNote(updatedNote);
      setNotes((currentNotes) =>
        currentNotes.map((note) => (note.id === updatedNote.id ? updatedNote : note)),
      );
      setSearchResults((currentResults) =>
        currentResults.map((result) =>
          result.id === updatedNote.id
            ? {
                ...result,
                ai_title: updatedNote.ai_title,
                short_summary: updatedNote.short_summary,
                tags: updatedNote.tags,
                date_added: updatedNote.date_added,
                category: updatedNote.category,
              }
            : result,
        ),
      );
    } catch (error) {
      setMetadataSaveError(getErrorMessage(error, "Could not update note metadata."));
      throw error;
    } finally {
      setIsSavingMetadata(false);
    }
  }

  async function handleDeleteNote(noteId: number) {
    const title = selectedNote?.id === noteId ? selectedNote.ai_title : "this note";

    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteNote(noteId);
      setNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId));
      setSearchResults((currentResults) => currentResults.filter((result) => result.id !== noteId));
      setSelectedNoteId(null);
      setSelectedNote(null);
      setDetailError(null);
      setMetadataSaveError(null);
      setLastDeletedNoteId(noteId);
    } catch (error) {
      setDeleteError(getErrorMessage(error, "Could not delete note."));
    } finally {
      setIsDeleting(false);
    }
  }

  const listTitle = isSearchActive
    ? `Results · ${activeSearchQuery}`
    : categoryScopeLabel;

  return (
    <div className="flex h-screen flex-col bg-bg text-text-primary">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-[13px] font-semibold tracking-tight text-text-primary">Note Memory</span>
        </div>
        <SegmentedControl mode={mode} onModeChange={setMode} />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface sm:w-72">
          <div className="shrink-0 p-2.5">
            <SearchBar
              isSearching={isSearching}
              onChange={handleSearchTextChange}
              onClear={clearSearch}
              onSubmit={handleSearchSubmit}
              query={searchText}
              scopeLabel={categoryScopeLabel}
              searchRef={searchRef}
            />
          </div>

          <div className="shrink-0 border-b border-border px-2.5 pb-2">
            <div className="mb-1.5 flex items-center justify-between px-0.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Categories</span>
              <button
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary disabled:opacity-40"
                disabled={isSavingCategory}
                onClick={() => {
                  setIsCreatingCategory((current) => !current);
                  setCategoryError(null);
                }}
                type="button"
              >
                {isCreatingCategory ? "Cancel" : "New"}
              </button>
            </div>
            <div className="flex flex-col gap-0.5">
              <button
                className={`rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                  selectedCategoryFilter === "all"
                    ? "bg-surface-raised text-text-primary"
                    : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                }`}
                onClick={() => handleCategoryFilterChange("all")}
                type="button"
              >
                All notes
              </button>
              <button
                className={`rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                  selectedCategoryFilter === "uncategorized"
                    ? "bg-surface-raised text-text-primary"
                    : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                }`}
                onClick={() => handleCategoryFilterChange("uncategorized")}
                type="button"
              >
                Uncategorized
              </button>
              {categories.map((category) => (
                <button
                  className={`truncate rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                    selectedCategoryFilter === category.id
                      ? "bg-surface-raised text-text-primary"
                      : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                  }`}
                  key={category.id}
                  onClick={() => handleCategoryFilterChange(category.id)}
                  title={category.name}
                  type="button"
                >
                  {category.name}
                </button>
              ))}
            </div>
            {isCreatingCategory ? (
              <form className="mt-2 flex gap-1.5" onSubmit={handleCreateCategory}>
                <input
                  aria-label="New category name"
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface-raised px-2 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
                  disabled={isSavingCategory}
                  onChange={(event) => {
                    setCategoryDraft(event.target.value);
                    setCategoryError(null);
                  }}
                  placeholder="Category name"
                  value={categoryDraft}
                />
                <button
                  className="rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-semibold text-black transition-colors hover:bg-accent-hover disabled:opacity-40"
                  disabled={isSavingCategory}
                  type="submit"
                >
                  Add
                </button>
              </form>
            ) : null}
            {categoryError ? <p className="mt-1.5 px-0.5 text-xs text-error">{categoryError}</p> : null}
          </div>

          <div className="shrink-0 px-3 py-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                {listTitle}
              </span>
              {!isSearchActive && !isLoadingNotes ? (
                <span className="text-[11px] tabular-nums text-text-muted">{visibleNotes.length}</span>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {!isSearchActive && isLoadingNotes ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-text-muted">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
                Loading...
              </div>
            ) : null}

            {isSearchActive && isSearching ? (
              <div className="flex items-center gap-2 px-2 py-3 text-xs text-text-muted">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
                Searching...
              </div>
            ) : null}

            {!isSearchActive && listError ? (
              <p className="px-2 py-3 text-xs text-error">{listError}</p>
            ) : null}
            {isSearchActive && searchError ? (
              <p className="px-2 py-3 text-xs text-error">{searchError}</p>
            ) : null}

            {!isSearchActive && !isLoadingNotes && !listError && notes.length === 0 ? (
              <div className="px-2 py-6 text-center">
                <p className="text-xs text-text-muted">No notes yet</p>
                <p className="mt-1 text-[11px] text-text-muted">
                  Press <kbd className="rounded bg-surface-raised px-1 py-0.5 text-[10px] font-medium text-text-secondary">{APP_SHORTCUTS.capture.label}</kbd> to capture
                </p>
              </div>
            ) : null}
            {!isSearchActive && !isLoadingNotes && !listError && notes.length > 0 && visibleNotes.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-text-muted">No notes in this category</p>
            ) : null}
            {isSearchActive && !isSearching && !searchError && searchResults.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-text-muted">No results found</p>
            ) : null}

            <div className="flex flex-col gap-0.5">
              {visibleNotes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  onSelect={selectNote}
                  selected={note.id === selectedNoteId}
                />
              ))}
            </div>
          </div>
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto bg-bg">
          {mode === "capture" ? (
            <div className="mx-auto max-w-3xl px-6 py-6">
              <CommandCenter
                askRef={askRef}
                askCategoryScope={categoryScope}
                askScopeKey={categoryScopeKey}
                askScopeLabel={categoryScopeLabel}
                captureRef={captureRef}
                categories={categories}
                draftCategoryId={draftCategoryId}
                draftText={draftText}
                isSaving={isSaving}
                mode={mode}
                onAskResult={setAskResult}
                onDraftCategoryChange={setDraftCategoryId}
                onDraftTextChange={(value) => {
                  setDraftText(value);
                  if (saveError) {
                    setSaveError(null);
                  }
                }}
                onSave={handleSaveNote}
                saveError={saveError}
              />
            </div>
          ) : mode === "ask" ? (
            <div className="mx-auto max-w-3xl px-6 py-6">
              <CommandCenter
                askRef={askRef}
                askCategoryScope={categoryScope}
                askScopeKey={categoryScopeKey}
                askScopeLabel={categoryScopeLabel}
                captureRef={captureRef}
                categories={categories}
                draftCategoryId={draftCategoryId}
                draftText={draftText}
                isSaving={isSaving}
                mode={mode}
                onAskResult={setAskResult}
                saveError={saveError}
                onDraftCategoryChange={setDraftCategoryId}
                onDraftTextChange={(value) => {
                  setDraftText(value);
                  if (saveError) {
                    setSaveError(null);
                  }
                }}
                onSave={handleSaveNote}
              />
              {askResult ? (
                <div className="mt-6 border-t border-border pt-6">
                  <ResultPanel
                    askResult={askResult}
                    categories={categories}
                    deleteError={deleteError}
                    deletedNoteId={lastDeletedNoteId}
                    error={detailError}
                    isDeleting={isDeleting}
                    isLoading={isLoadingDetail}
                    isSavingMetadata={isSavingMetadata}
                    note={selectedNote}
                    onDelete={handleDeleteNote}
                    onSaveMetadata={handleUpdateNoteMetadata}
                    saveError={metadataSaveError}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="px-6 py-6">
              <ResultPanel
                askResult={askResult}
                categories={categories}
                deleteError={deleteError}
                deletedNoteId={lastDeletedNoteId}
                error={detailError}
                isDeleting={isDeleting}
                isLoading={isLoadingDetail}
                isSavingMetadata={isSavingMetadata}
                note={selectedNote}
                onDelete={handleDeleteNote}
                onSaveMetadata={handleUpdateNoteMetadata}
                saveError={metadataSaveError}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

