import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";

import {
  createCategory,
  createNote,
  deleteNote,
  getNote,
  listCategories,
  listNotes,
  searchNotes,
  askQuestion,
  updateNote,
} from "./api";
import {
  areAskNoteScopesEqual,
  clearAskNotes,
  DEFAULT_ASK_NOTE_SCOPE,
  getAskNoteScopeSelectedCount,
  isNoteSelectedForAsk,
  normalizeAskNoteScope,
  selectAllAskNotes,
  toggleAskNoteScope,
} from "./askScope";
import { AskChat } from "./components/AskChat";
import { NoteWorkspace, type NoteWorkspaceMode } from "./components/NoteWorkspace";
import { NoteCard } from "./components/NoteCard";
import { SearchBar } from "./components/SearchBar";
import { APP_SHORTCUTS, useKeyboardShortcuts, type AppMode } from "./hooks/useKeyboardShortcuts";
import type { MarkdownPaneHandle } from "./components/MarkdownPane";
import type {
  AskHistoryMessage,
  AskNoteScope,
  Category,
  CategoryScopeRequest,
  ChatMessage,
  Note,
  NoteCardData,
  SearchResult,
} from "./types";

type CategoryFilter = "all" | "uncategorized" | number;
type AskHistorySourceMessage = Extract<ChatMessage, { role: "user" | "assistant" }>;

const ASK_HISTORY_MESSAGE_LIMIT = 6;

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function buildRecentAskHistory(
  messages: ChatMessage[],
  pendingMessageId: string | null,
): AskHistoryMessage[] {
  return messages
    .filter(
      (message): message is AskHistorySourceMessage =>
        (message.role === "user" || message.role === "assistant") &&
        message.id !== pendingMessageId &&
        message.content.trim().length > 0,
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .slice(-ASK_HISTORY_MESSAGE_LIMIT);
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

function categoryFilterLabel(filter: CategoryFilter, categories: Category[]): string {
  if (filter === "all") {
    return "All notes";
  }

  if (filter === "uncategorized") {
    return "Uncategorized";
  }

  return categories.find((category) => category.id === filter)?.name ?? "Category";
}

function formatCompactAskScopeLabel(scope: AskNoteScope, totalNotes: number): string {
  if (scope.mode === "all") {
    return "Ask scope: All notes";
  }

  const selectedCount = getAskNoteScopeSelectedCount(scope, totalNotes);
  if (selectedCount === 0) {
    return "Ask scope: None selected";
  }

  return selectedCount === 1 ? "Ask scope: 1 selected" : `Ask scope: ${selectedCount} selected`;
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
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreatingCategory, setIsCreatingCategory] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [workspaceMode, setWorkspaceMode] = useState<NoteWorkspaceMode>("new");
  const [isSelectedNoteEditDirty, setIsSelectedNoteEditDirty] = useState(false);
  const [askMessages, setAskMessages] = useState<ChatMessage[]>([]);
  const [askPendingMessageId, setAskPendingMessageId] = useState<string | null>(null);
  const [askNoteScope, setAskNoteScope] = useState(DEFAULT_ASK_NOTE_SCOPE);

  const searchRequestId = useRef(0);
  const askRequestId = useRef(0);
  const askMessageId = useRef(0);
  const askPendingMessageIdRef = useRef<string | null>(null);
  const captureRef = useRef<MarkdownPaneHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);

  const categoryScope = categoryFilterScope(selectedCategoryFilter);
  const categoryScopeLabel = categoryFilterLabel(selectedCategoryFilter, categories);
  const isSearchActive = activeSearchQuery !== null;
  const categoryFilteredNotes = filterNotesByCategory(notes, selectedCategoryFilter);
  const visibleNotes: NoteCardData[] = isSearchActive ? searchResults : categoryFilteredNotes;
  const hasUnsavedSelectedNoteEdit = workspaceMode === "edit-selected" && isSelectedNoteEditDirty;
  const askAvailableNoteIds = useMemo(() => notes.map((note) => note.id), [notes]);
  const askScopeLabel = formatCompactAskScopeLabel(askNoteScope, notes.length);
  const isAskNoteScopeEmpty = askNoteScope.mode === "custom" && askNoteScope.noteIds.length === 0;

  const confirmDiscardSelectedNoteEdit = useCallback((): boolean => {
    if (!hasUnsavedSelectedNoteEdit) {
      return true;
    }

    return window.confirm("Discard unsaved note changes?");
  }, [hasUnsavedSelectedNoteEdit]);

  const handleModeChange = useCallback((nextMode: AppMode) => {
    if (nextMode === "capture") {
      setWorkspaceMode("new");
    } else if (nextMode === "search") {
      setWorkspaceMode("read-selected");
    }
  }, []);

  useKeyboardShortcuts(handleModeChange, { captureRef, searchRef, askRef });

  const openSelectedNote = useCallback((noteId: number) => {
    setIsSelectedNoteEditDirty(false);
    setEditError(null);
    setSelectedNoteId(noteId);
    setWorkspaceMode("read-selected");
  }, []);

  const selectNote = useCallback(
    (noteId: number) => {
      if (!confirmDiscardSelectedNoteEdit()) {
        return;
      }

      openSelectedNote(noteId);
    },
    [confirmDiscardSelectedNoteEdit, openSelectedNote],
  );

  const clearSearch = useCallback(() => {
    searchRequestId.current += 1;
    setSearchText("");
    setActiveSearchQuery(null);
    setSearchResults([]);
    setSearchError(null);
    setIsSearching(false);
  }, []);

  const handleToggleAskNoteScope = useCallback(
    (noteId: number) => {
      setAskNoteScope((currentScope) =>
        toggleAskNoteScope(currentScope, noteId, askAvailableNoteIds),
      );
    },
    [askAvailableNoteIds],
  );

  const handleSelectAllAskNotes = useCallback(() => {
    setAskNoteScope(selectAllAskNotes());
  }, []);

  const handleClearAskNotes = useCallback(() => {
    setAskNoteScope(clearAskNotes());
  }, []);

  const handleAskSourceSelect = useCallback(
    (noteId: number) => {
      if (!confirmDiscardSelectedNoteEdit()) {
        return;
      }

      const sourceNote = notes.find((note) => note.id === noteId);
      if (sourceNote) {
        clearSearch();
        setCategoryError(null);
        setSelectedCategoryFilter(sourceNote.category?.id ?? "uncategorized");
        setDraftCategoryId(sourceNote.category?.id ?? null);
      }

      openSelectedNote(noteId);
    },
    [clearSearch, confirmDiscardSelectedNoteEdit, notes, openSelectedNote],
  );

  const handleCategoryFilterChange = useCallback(
    (filter: CategoryFilter) => {
      if (!confirmDiscardSelectedNoteEdit()) {
        return;
      }

      clearSearch();
      setSelectedCategoryFilter(filter);
      setCategoryError(null);
      setEditError(null);
      setIsSelectedNoteEditDirty(false);
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
    [clearSearch, confirmDiscardSelectedNoteEdit, notes],
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
        setSelectedNoteId(null);
        setSelectedNote(null);
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
    const normalizedAskNoteScope = normalizeAskNoteScope(askNoteScope, askAvailableNoteIds);

    if (!areAskNoteScopesEqual(askNoteScope, normalizedAskNoteScope)) {
      setAskNoteScope(normalizedAskNoteScope);
    }
  }, [askAvailableNoteIds, askNoteScope]);

  useEffect(() => {
    if (selectedNoteId === null) {
      return;
    }

    const noteId = selectedNoteId;
    let ignore = false;

    async function loadSelectedNote() {
      setIsLoadingDetail(true);
      setDetailError(null);
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

  function createAskMessageId() {
    askMessageId.current += 1;
    return `ask:${askMessageId.current}`;
  }

  async function handleAskSubmit(question: string) {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || askPendingMessageIdRef.current !== null || isAskNoteScopeEmpty) {
      return;
    }

    const requestId = askRequestId.current + 1;
    askRequestId.current = requestId;
    const history = buildRecentAskHistory(askMessages, askPendingMessageIdRef.current);

    const userMessage: ChatMessage = {
      id: createAskMessageId(),
      role: "user",
      content: trimmedQuestion,
    };
    const pendingMessageId = createAskMessageId();
    const pendingMessage: ChatMessage = {
      id: pendingMessageId,
      role: "assistant",
      content: "Reading notes...",
      sources: [],
    };

    askPendingMessageIdRef.current = pendingMessageId;
    setAskPendingMessageId(pendingMessageId);
    setAskMessages((currentMessages) => [...currentMessages, userMessage, pendingMessage]);

    try {
      const result = await askQuestion({
        question: trimmedQuestion,
        history,
        ...categoryScope,
        ...(askNoteScope.mode === "custom" ? { note_ids: askNoteScope.noteIds } : {}),
      });
      if (askRequestId.current === requestId && askPendingMessageIdRef.current === pendingMessageId) {
        setAskMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === pendingMessageId
              ? {
                  id: pendingMessageId,
                  role: "assistant",
                  content: result.answer,
                  sources: result.sources,
                }
              : message,
          ),
        );
      }
    } catch (error) {
      if (askRequestId.current === requestId && askPendingMessageIdRef.current === pendingMessageId) {
        setAskMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === pendingMessageId
              ? {
                  id: pendingMessageId,
                  role: "error",
                  content: getErrorMessage(error, "Could not reach your notes."),
                }
              : message,
          ),
        );
      }
    } finally {
      if (askRequestId.current === requestId && askPendingMessageIdRef.current === pendingMessageId) {
        askPendingMessageIdRef.current = null;
        setAskPendingMessageId(null);
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
      setSelectedCategoryFilter(savedNote.category?.id ?? "uncategorized");
      setDraftText("");
      setSelectedNote(savedNote);
      setSelectedNoteId(savedNote.id);
      setWorkspaceMode("read-selected");
    } catch (error) {
      setSaveError(getErrorMessage(error, "Could not save note."));
    } finally {
      setIsSaving(false);
    }
  }

  const handleNewNote = useCallback(() => {
    if (!confirmDiscardSelectedNoteEdit()) {
      return;
    }

    setIsSelectedNoteEditDirty(false);
    setSelectedNoteId(null);
    setSelectedNote(null);
    setDetailError(null);
    setDeleteError(null);
    setEditError(null);
    setWorkspaceMode("new");
  }, [confirmDiscardSelectedNoteEdit]);

  const handleEditSelectedNote = useCallback(() => {
    if (!selectedNote) {
      return;
    }

    setEditError(null);
    setWorkspaceMode("edit-selected");
  }, [selectedNote]);

  const handleCancelEditSelectedNote = useCallback(() => {
    setIsSelectedNoteEditDirty(false);
    setEditError(null);
    setWorkspaceMode("read-selected");
  }, []);

  async function handleSaveSelectedNoteEdit(body: {
    original_text: string;
    ai_title: string;
    short_summary: string;
    tags: string[];
    category_id: number | null;
  }) {
    if (!selectedNote) {
      return;
    }

    setIsSavingEdit(true);
    setEditError(null);

    try {
      const savedNote = await updateNote(selectedNote.id, body);
      const savedCategoryFilter = savedNote.category?.id ?? "uncategorized";

      setSelectedNote(savedNote);
      setNotes((currentNotes) =>
        currentNotes.map((note) => (note.id === savedNote.id ? savedNote : note)),
      );
      setSearchResults((currentResults) =>
        currentResults.map((result) => (result.id === savedNote.id ? { ...result, ...savedNote } : result)),
      );
      setSelectedCategoryFilter(savedCategoryFilter);
      setDraftCategoryId(savedNote.category?.id ?? null);
      setIsSelectedNoteEditDirty(false);
      setWorkspaceMode("read-selected");
    } catch (error) {
      setEditError(getErrorMessage(error, "Could not save note changes."));
    } finally {
      setIsSavingEdit(false);
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
      setEditError(null);
      setIsSelectedNoteEditDirty(false);
      setWorkspaceMode("new");
    } catch (error) {
      setDeleteError(getErrorMessage(error, "Could not delete note."));
    } finally {
      setIsDeleting(false);
    }
  }

  const listTitle = isSearchActive
    ? `Results for “${activeSearchQuery}”`
    : categoryScopeLabel;
  const searchStatus = isSearching
    ? "Searching..."
    : searchError
      ? "Search failed"
      : searchResults.length === 0
        ? "No results"
        : searchResults.length === 1
          ? "1 found"
          : `${searchResults.length} found`;

  return (
    <div className="flex h-screen bg-bg text-text-primary">
      <aside
        aria-label="Notes sidebar"
        className="flex w-64 shrink-0 flex-col border-r border-border bg-surface sm:w-72"
      >
        <div className="shrink-0 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="text-[13px] font-semibold tracking-tight text-text-primary">Note Memory</span>
          </div>
        </div>

        <div className="shrink-0 border-b border-border p-2.5">
          <button
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-semibold text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isSaving || isSavingEdit || isDeleting}
            onClick={handleNewNote}
            type="button"
          >
            <Plus size={14} strokeWidth={2} />
            New note
          </button>
        </div>

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
          <div className="mb-1.5 px-0.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">Notes</span>
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
          </div>
        </div>

        <div className="shrink-0 border-b border-border px-2.5 py-2">
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
            {isSearchActive ? (
              <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{searchStatus}</span>
            ) : !isLoadingNotes ? (
              <span className="shrink-0 text-[11px] tabular-nums text-text-muted">{visibleNotes.length}</span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-text-muted">
              {askScopeLabel}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary"
                onClick={handleSelectAllAskNotes}
                type="button"
              >
                All
              </button>
              <button
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary"
                onClick={handleClearAskNotes}
                type="button"
              >
                Clear
              </button>
            </div>
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
                Press <kbd className="rounded bg-surface-raised px-1 py-0.5 text-[10px] font-medium text-text-secondary">{APP_SHORTCUTS.capture.label}</kbd> for a new note
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
                askScopeSelected={isNoteSelectedForAsk(askNoteScope, note.id)}
                key={note.id}
                mode={isSearchActive ? "search" : "browse"}
                note={note}
                onAskScopeToggle={handleToggleAskNoteScope}
                onSelect={selectNote}
                selected={note.id === selectedNoteId}
              />
            ))}
          </div>
        </div>
      </aside>

      <main className="min-h-0 flex-1 overflow-hidden bg-bg">
        <NoteWorkspace
          captureRef={captureRef}
          categories={categories}
          deleteError={deleteError}
          draftCategoryId={draftCategoryId}
          draftText={draftText}
          error={detailError}
          isDeleting={isDeleting}
          isLoading={isLoadingDetail}
          isSavingEdit={isSavingEdit}
          isSaving={isSaving}
          mode={workspaceMode}
          note={selectedNote}
          editError={editError}
          onCancelEdit={handleCancelEditSelectedNote}
          onDelete={handleDeleteNote}
          onDraftCategoryChange={setDraftCategoryId}
          onDraftTextChange={(value) => {
            setDraftText(value);
            if (saveError) {
              setSaveError(null);
            }
          }}
          onEdit={handleEditSelectedNote}
          onEditDirtyChange={setIsSelectedNoteEditDirty}
          onNewNote={handleNewNote}
          onSave={handleSaveNote}
          onSaveEdit={handleSaveSelectedNoteEdit}
          saveError={saveError}
        />
      </main>

      <aside className="hidden min-h-0 w-80 shrink-0 border-l border-border bg-bg p-4 lg:flex xl:w-96">
        <AskChat
          askRef={askRef}
          messages={askMessages}
          onSourceSelect={handleAskSourceSelect}
          onSubmit={handleAskSubmit}
          pendingMessageId={askPendingMessageId}
          isSubmitDisabled={isAskNoteScopeEmpty}
          scopeLabel={categoryScopeLabel}
          submitDisabledMessage={isAskNoteScopeEmpty ? "Select at least one note for Ask" : undefined}
        />
      </aside>
    </div>
  );
}
