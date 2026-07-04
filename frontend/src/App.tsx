import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";

import {
  createCategory,
  createNote,
  deleteCategory,
  deleteNote,
  getNote,
  listCategories,
  listNotes,
  searchNotes,
  askQuestion,
  updateCategory,
  updateNote,
} from "./api";
import {
  areAskNoteScopesEqual,
  clearAskNotes,
  DEFAULT_ASK_NOTE_SCOPE,
  formatAskNoteScopeSelectedCount,
  getAskNoteScopeSelectedCount,
  isNoteSelectedForAsk,
  normalizeAskNoteScope,
  selectAllAskNotes,
  setAskNoteScopeSelected,
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
  ChatMessage,
  Note,
  NoteCardData,
  SearchResult,
} from "./types";

type CategoryFilter = "all" | "uncategorized" | number;
type SidebarTab = "browse" | "search";
type AskHistorySourceMessage = Extract<ChatMessage, { role: "user" | "assistant" }>;
type BrowseFolder = {
  filter: Exclude<CategoryFilter, "all">;
  key: string;
  label: string;
  notes: Note[];
};
type NoteDropTarget = {
  categoryId: number | null;
  key: string;
};

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

function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id - right.id,
  );
}

function categoryFilterKey(filter: Exclude<CategoryFilter, "all">): string {
  return filter === "uncategorized" ? "uncategorized" : `category:${filter}`;
}

function formatAskChatScopeLabel(scope: AskNoteScope, totalNotes: number): string {
  if (scope.mode === "all") {
    return "All notes";
  }

  const selectedCount = getAskNoteScopeSelectedCount(scope, totalNotes);
  if (selectedCount === 0) {
    return "No notes selected";
  }

  return selectedCount === 1 ? "1 note selected" : `${selectedCount} notes selected`;
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<CategoryFilter>("all");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("browse");
  const [draftText, setDraftText] = useState("");
  const [draftCategoryId, setDraftCategoryId] = useState<number | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [categoryEditDraft, setCategoryEditDraft] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [activeSearchQuery, setActiveSearchQuery] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [isLoadingNotes, setIsLoadingNotes] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);
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
  const [expandedFolderKeys, setExpandedFolderKeys] = useState<Set<string>>(() => new Set());
  const [draggedNoteId, setDraggedNoteId] = useState<number | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  const searchRequestId = useRef(0);
  const askRequestId = useRef(0);
  const askMessageId = useRef(0);
  const askPendingMessageIdRef = useRef<string | null>(null);
  const draggedNoteIdRef = useRef<number | null>(null);
  const captureRef = useRef<MarkdownPaneHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);

  const isBrowseTab = sidebarTab === "browse";
  const isSearchTab = sidebarTab === "search";
  const isSearchActive = activeSearchQuery !== null;
  const sortedCategories = useMemo(() => sortCategories(categories), [categories]);
  const uncategorizedNotes = useMemo(
    () => notes.filter((note) => note.category === null),
    [notes],
  );
  const browseFolders = useMemo<BrowseFolder[]>(
    () => [
      {
        filter: "uncategorized",
        key: "uncategorized",
        label: "Uncategorized",
        notes: uncategorizedNotes,
      },
      ...sortedCategories.map((category) => ({
        filter: category.id,
        key: categoryFilterKey(category.id),
        label: category.name,
        notes: notes.filter((note) => note.category?.id === category.id),
      })),
    ],
    [notes, sortedCategories, uncategorizedNotes],
  );
  const visibleNotes: NoteCardData[] = searchResults;
  const hasUnsavedSelectedNoteEdit = workspaceMode === "edit-selected" && isSelectedNoteEditDirty;
  const askAvailableNoteIds = useMemo(() => notes.map((note) => note.id), [notes]);
  const askScopeSummary = formatAskNoteScopeSelectedCount(askNoteScope, notes.length);
  const askChatScopeLabel = formatAskChatScopeLabel(askNoteScope, notes.length);
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
      setSidebarTab("search");
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

  const handleToggleAllAskNotes = useCallback(() => {
    setAskNoteScope((currentScope) =>
      currentScope.mode === "all" ? clearAskNotes() : selectAllAskNotes(),
    );
  }, []);

  const handleSetAskSourceNotesSelected = useCallback(
    (noteIds: number[], selected: boolean) => {
      setAskNoteScope((currentScope) =>
        setAskNoteScopeSelected(currentScope, noteIds, selected, askAvailableNoteIds),
      );
    },
    [askAvailableNoteIds],
  );

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
    },
    [clearSearch, confirmDiscardSelectedNoteEdit],
  );

  const toggleFolder = useCallback((folderKey: string) => {
    setExpandedFolderKeys((currentKeys) => {
      const nextKeys = new Set(currentKeys);
      if (nextKeys.has(folderKey)) {
        nextKeys.delete(folderKey);
      } else {
        nextKeys.add(folderKey);
      }

      return nextKeys;
    });
  }, []);

  const handleFolderClick = useCallback(
    (folder: BrowseFolder) => {
      handleCategoryFilterChange(folder.filter);
      toggleFolder(folder.key);
    },
    [handleCategoryFilterChange, toggleFolder],
  );

  const getFolderDropTarget = useCallback(
    (folder: BrowseFolder): NoteDropTarget => ({
      categoryId: folder.filter === "uncategorized" ? null : folder.filter,
      key: folder.key,
    }),
    [],
  );

  const clearNoteDrag = useCallback(() => {
    draggedNoteIdRef.current = null;
    setDraggedNoteId(null);
    setDropTargetKey(null);
  }, []);

  const handleNoteDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, noteId: number) => {
      if (!confirmDiscardSelectedNoteEdit()) {
        event.preventDefault();
        clearNoteDrag();
        return;
      }

      if (hasUnsavedSelectedNoteEdit) {
        setIsSelectedNoteEditDirty(false);
        setEditError(null);
        setWorkspaceMode("read-selected");
      }

      draggedNoteIdRef.current = noteId;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(noteId));
      }
      setDraggedNoteId(noteId);
    },
    [clearNoteDrag, confirmDiscardSelectedNoteEdit, hasUnsavedSelectedNoteEdit],
  );

  const handleFolderDragOver = useCallback(
    (event: DragEvent<HTMLButtonElement>, target: NoteDropTarget) => {
      const activeDraggedNoteId = draggedNoteIdRef.current ?? draggedNoteId;
      if (activeDraggedNoteId === null) {
        return;
      }

      const draggedNote = notes.find((note) => note.id === activeDraggedNoteId);
      if (!draggedNote || (draggedNote.category?.id ?? null) === target.categoryId) {
        return;
      }

      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      setDropTargetKey(target.key);
    },
    [draggedNoteId, notes],
  );

  const handleFolderDragLeave = useCallback((target: NoteDropTarget) => {
    setDropTargetKey((currentKey) => (currentKey === target.key ? null : currentKey));
  }, []);

  const handleFolderDrop = useCallback(
    async (event: DragEvent<HTMLButtonElement>, target: NoteDropTarget) => {
      event.preventDefault();

      const activeDraggedNoteId = draggedNoteIdRef.current ?? draggedNoteId;
      if (activeDraggedNoteId === null) {
        clearNoteDrag();
        return;
      }

      const draggedNote = notes.find((note) => note.id === activeDraggedNoteId);
      if (!draggedNote || (draggedNote.category?.id ?? null) === target.categoryId) {
        clearNoteDrag();
        return;
      }

      setCategoryError(null);
      setExpandedFolderKeys((currentKeys) => new Set(currentKeys).add(target.key));

      try {
        const savedNote = await updateNote(activeDraggedNoteId, { category_id: target.categoryId });
        setNotes((currentNotes) =>
          currentNotes.map((note) => (note.id === savedNote.id ? savedNote : note)),
        );
        setSearchResults((currentResults) =>
          currentResults.map((result) =>
            result.id === savedNote.id ? { ...result, ...savedNote } : result,
          ),
        );
        setSelectedNote((currentNote) => (currentNote?.id === savedNote.id ? savedNote : currentNote));
        if (selectedNoteId === savedNote.id) {
          setSelectedCategoryFilter(savedNote.category?.id ?? "uncategorized");
          setDraftCategoryId(savedNote.category?.id ?? null);
        }
      } catch (error) {
        setCategoryError(getErrorMessage(error, "Could not move note."));
      } finally {
        clearNoteDrag();
      }
    },
    [clearNoteDrag, draggedNoteId, notes, selectedNoteId],
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
        setExpandedFolderKeys(new Set());
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
    if (!isSearchTab) {
      return;
    }

    searchRef.current?.focus();
  }, [isSearchTab]);

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
      const results = await searchNotes(query);
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
      setSelectedCategoryFilter(category.id);
      setDraftCategoryId(category.id);
      setSelectedNote(null);
      setSelectedNoteId(null);
      setExpandedFolderKeys((currentKeys) => new Set(currentKeys).add(categoryFilterKey(category.id)));
    } catch (error) {
      setCategoryError(getErrorMessage(error, "Could not create category."));
    } finally {
      setIsSavingCategory(false);
    }
  }

  async function handleRenameCategory(event: FormEvent, categoryId: number) {
    event.preventDefault();

    const name = categoryEditDraft.trim();
    if (!name) {
      setCategoryError("Enter a category name.");
      return;
    }

    setIsUpdatingCategory(true);
    setCategoryError(null);

    try {
      const category = await updateCategory(categoryId, name);
      setCategories((currentCategories) =>
        sortCategories(
          currentCategories.map((currentCategory) =>
            currentCategory.id === category.id ? category : currentCategory,
          ),
        ),
      );
      setNotes((currentNotes) =>
        currentNotes.map((note) =>
          note.category?.id === category.id ? { ...note, category } : note,
        ),
      );
      setSearchResults((currentResults) =>
        currentResults.map((result) =>
          result.category?.id === category.id ? { ...result, category } : result,
        ),
      );
      setSelectedNote((currentNote) =>
        currentNote?.category?.id === category.id ? { ...currentNote, category } : currentNote,
      );
      setEditingCategoryId(null);
      setCategoryEditDraft("");
    } catch (error) {
      setCategoryError(getErrorMessage(error, "Could not rename category."));
    } finally {
      setIsUpdatingCategory(false);
    }
  }

  async function handleDeleteCategory(category: Category, noteCount: number) {
    const noteLabel = noteCount === 1 ? "1 note" : `${noteCount} notes`;
    if (!window.confirm(`Delete "${category.name}" and its ${noteLabel}? This cannot be undone.`)) {
      return;
    }

    setDeletingCategoryId(category.id);
    setCategoryError(null);

    try {
      const result = await deleteCategory(category.id);
      const deletedNoteIds = new Set(result.deleted_note_ids);
      setCategories((currentCategories) =>
        currentCategories.filter((currentCategory) => currentCategory.id !== category.id),
      );
      setNotes((currentNotes) => currentNotes.filter((note) => !deletedNoteIds.has(note.id)));
      setSearchResults((currentResults) =>
        currentResults.filter((result) => !deletedNoteIds.has(result.id)),
      );
      setExpandedFolderKeys((currentKeys) => {
        const nextKeys = new Set(currentKeys);
        nextKeys.delete(categoryFilterKey(category.id));
        return nextKeys;
      });
      if (selectedCategoryFilter === category.id) {
        setSelectedCategoryFilter("all");
      }
      if (draftCategoryId === category.id) {
        setDraftCategoryId(null);
      }
      if (selectedNoteId !== null && deletedNoteIds.has(selectedNoteId)) {
        setSelectedNoteId(null);
        setSelectedNote(null);
        setWorkspaceMode("new");
        setDetailError(null);
        setDeleteError(null);
        setEditError(null);
        setIsSelectedNoteEditDirty(false);
      }
      if (editingCategoryId === category.id) {
        setEditingCategoryId(null);
        setCategoryEditDraft("");
      }
    } catch (error) {
      setCategoryError(getErrorMessage(error, "Could not delete category."));
    } finally {
      setDeletingCategoryId(null);
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

        <div className="shrink-0 border-b border-border p-2.5">
          <div
            aria-label="Sidebar mode"
            className="grid grid-cols-2 rounded-md bg-surface-raised p-0.5"
            role="tablist"
          >
            <button
              aria-selected={isBrowseTab}
              className={`rounded px-2 py-1.5 text-[12px] font-medium transition-colors ${
                isBrowseTab
                  ? "bg-surface-hover text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              }`}
              onClick={() => setSidebarTab("browse")}
              role="tab"
              type="button"
            >
              Browse
            </button>
            <button
              aria-selected={isSearchTab}
              className={`rounded px-2 py-1.5 text-[12px] font-medium transition-colors ${
                isSearchTab
                  ? "bg-surface-hover text-text-primary"
                  : "text-text-muted hover:text-text-secondary"
              }`}
              onClick={() => setSidebarTab("search")}
              role="tab"
              type="button"
            >
              Search
            </button>
          </div>
        </div>

        {isSearchTab ? (
          <div className="shrink-0 border-b border-border p-2.5">
            <SearchBar
              isSearching={isSearching}
              onChange={handleSearchTextChange}
              onClear={clearSearch}
              onSubmit={handleSearchSubmit}
              query={searchText}
              searchRef={searchRef}
            />
            {isSearchActive ? (
              <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
                <span className="min-w-0 truncate text-[11px] text-text-secondary">
                  Results for “{activeSearchQuery}”
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                  {searchStatus}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {isBrowseTab ? (
          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <button
                aria-expanded={isCategoryManagerOpen}
                className="inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                onClick={() => {
                  setIsCategoryManagerOpen((current) => !current);
                  setCategoryError(null);
                }}
                type="button"
              >
                {isCategoryManagerOpen ? (
                  <ChevronDown aria-hidden="true" size={14} strokeWidth={2} />
                ) : (
                  <ChevronRight aria-hidden="true" size={14} strokeWidth={2} />
                )}
                Categories
              </button>
              <span className="shrink-0 text-[10px] text-text-muted">{askScopeSummary}</span>
            </div>

            {isCategoryManagerOpen ? (
              <div
                aria-label="Manage categories"
                className="mt-2 rounded-md border border-border bg-surface-raised p-2"
                role="region"
              >
                <form className="flex gap-1.5" onSubmit={handleCreateCategory}>
                  <input
                    aria-label="New category name"
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-[13px] text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
                    disabled={isSavingCategory}
                    onChange={(event) => {
                      setCategoryDraft(event.target.value);
                      setCategoryError(null);
                    }}
                    placeholder="New category"
                    value={categoryDraft}
                  />
                  <button
                    aria-label="Add category"
                    className="inline-flex items-center justify-center rounded-md bg-accent px-2.5 py-1.5 text-black transition-colors hover:bg-accent-hover disabled:opacity-40"
                    disabled={isSavingCategory}
                    type="submit"
                  >
                    <Plus size={14} strokeWidth={2} />
                  </button>
                </form>

                {sortedCategories.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1">
                    {sortedCategories.map((category) => {
                      const noteCount = notes.filter((note) => note.category?.id === category.id).length;
                      const isEditingCategory = editingCategoryId === category.id;

                      return (
                        <div className="rounded border border-border bg-surface px-2 py-1.5" key={category.id}>
                          {isEditingCategory ? (
                            <form
                              className="flex gap-1.5"
                              onSubmit={(event) => handleRenameCategory(event, category.id)}
                            >
                              <input
                                aria-label="Category name"
                                className="min-w-0 flex-1 rounded-md border border-border bg-surface-raised px-2 py-1 text-[13px] text-text-primary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
                                disabled={isUpdatingCategory}
                                onChange={(event) => {
                                  setCategoryEditDraft(event.target.value);
                                  setCategoryError(null);
                                }}
                                value={categoryEditDraft}
                              />
                              <button
                                aria-label="Save category"
                                className="rounded p-1 text-accent transition-colors hover:bg-surface-hover disabled:opacity-40"
                                disabled={isUpdatingCategory}
                                type="submit"
                              >
                                <Check size={14} strokeWidth={2} />
                              </button>
                              <button
                                aria-label="Cancel category rename"
                                className="rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary disabled:opacity-40"
                                disabled={isUpdatingCategory}
                                onClick={() => {
                                  setEditingCategoryId(null);
                                  setCategoryEditDraft("");
                                  setCategoryError(null);
                                }}
                                type="button"
                              >
                                <X size={14} strokeWidth={2} />
                              </button>
                            </form>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
                                {category.name}
                              </span>
                              <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
                                {noteCount}
                              </span>
                              <button
                                aria-label={`Rename ${category.name}`}
                                className="rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-secondary disabled:opacity-40"
                                disabled={isUpdatingCategory || deletingCategoryId !== null}
                                onClick={() => {
                                  setEditingCategoryId(category.id);
                                  setCategoryEditDraft(category.name);
                                  setCategoryError(null);
                                }}
                                type="button"
                              >
                                <Pencil size={13} strokeWidth={2} />
                              </button>
                              <button
                                aria-label={`Delete ${category.name}`}
                                className="rounded p-1 text-text-muted transition-colors hover:bg-error-muted hover:text-error disabled:opacity-40"
                                disabled={isUpdatingCategory || deletingCategoryId !== null}
                                onClick={() => void handleDeleteCategory(category, noteCount)}
                                type="button"
                              >
                                <Trash2 size={13} strokeWidth={2} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {categoryError ? (
              <p className="mt-1.5 px-0.5 text-xs text-error">{categoryError}</p>
            ) : null}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {isBrowseTab && isLoadingNotes ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-text-muted">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
              Loading...
            </div>
          ) : null}

          {isSearchTab && isSearching ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-text-muted">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
              Searching...
            </div>
          ) : null}

          {isBrowseTab && listError ? (
            <p className="px-2 py-3 text-xs text-error">{listError}</p>
          ) : null}
          {isSearchTab && searchError ? (
            <p className="px-2 py-3 text-xs text-error">{searchError}</p>
          ) : null}

          {isBrowseTab && !isLoadingNotes && !listError && notes.length === 0 ? (
            <div className="px-2 py-6 text-center">
              <p className="text-xs text-text-muted">No notes yet</p>
              <p className="mt-1 text-[11px] text-text-muted">
                Press <kbd className="rounded bg-surface-raised px-1 py-0.5 text-[10px] font-medium text-text-secondary">{APP_SHORTCUTS.capture.label}</kbd> for a new note
              </p>
            </div>
          ) : null}
          {isSearchTab && isSearchActive && !isSearching && !searchError && searchResults.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-text-muted">No results found</p>
          ) : null}

          {isSearchTab && isSearchActive ? (
            <div className="flex flex-col gap-0.5">
              {visibleNotes.map((note) => (
                <NoteCard
                  askScopeSelected={isNoteSelectedForAsk(askNoteScope, note.id)}
                  key={note.id}
                  mode="search"
                  note={note}
                  onAskScopeToggle={handleToggleAskNoteScope}
                  onSelect={selectNote}
                  selected={note.id === selectedNoteId}
                  showAskScopeCheckbox
                />
              ))}
            </div>
          ) : null}

          {isBrowseTab && !isLoadingNotes && !listError && notes.length > 0 ? (
            <div aria-label="Browse notes" className="flex flex-col gap-0.5" role="tree">
              <div className="flex items-center gap-1 rounded-md pr-1">
                <input
                  aria-label="Use all notes for Ask"
                  checked={askNoteScope.mode === "all"}
                  className="ml-2 h-3 w-3 shrink-0 rounded border-border bg-surface-raised accent-accent opacity-75 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                  onChange={handleToggleAllAskNotes}
                  type="checkbox"
                />
                <button
                  aria-selected={selectedCategoryFilter === "all"}
                  className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                    selectedCategoryFilter === "all"
                      ? "bg-surface-raised text-text-primary"
                      : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                  }`}
                  onClick={() => handleCategoryFilterChange("all")}
                  type="button"
                >
                  <FileText aria-hidden="true" className="shrink-0" size={14} strokeWidth={2} />
                  <span className="min-w-0 flex-1 truncate">All notes</span>
                  <span aria-hidden="true" className="shrink-0 text-[10px] tabular-nums text-text-muted">
                    {notes.length}
                  </span>
                </button>
              </div>

              {browseFolders.map((folder) => {
                const isExpanded = expandedFolderKeys.has(folder.key);
                const isSelected = selectedCategoryFilter === folder.filter;
                const FolderIcon = isExpanded ? FolderOpen : Folder;
                const folderNoteIds = folder.notes.map((note) => note.id);
                const selectedFolderNoteCount = folderNoteIds.filter((noteId) =>
                  isNoteSelectedForAsk(askNoteScope, noteId),
                ).length;
                const isFolderAskSelected =
                  folderNoteIds.length > 0 && selectedFolderNoteCount === folderNoteIds.length;
                const isFolderAskPartiallySelected =
                  selectedFolderNoteCount > 0 && selectedFolderNoteCount < folderNoteIds.length;
                const folderDropTarget = getFolderDropTarget(folder);
                const isDropTarget = dropTargetKey === folder.key;

                return (
                  <div className="flex flex-col gap-0.5" key={folder.key}>
                    <div className="flex items-center gap-1 rounded-md pr-1">
                      <input
                        aria-label={`Use ${folder.label} category for Ask`}
                        checked={isFolderAskSelected}
                        className="ml-2 h-3 w-3 shrink-0 rounded border-border bg-surface-raised accent-accent opacity-75 transition-opacity hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
                        disabled={folderNoteIds.length === 0}
                        onChange={() =>
                          handleSetAskSourceNotesSelected(folderNoteIds, !isFolderAskSelected)
                        }
                        ref={(input) => {
                          if (input) {
                            input.indeterminate = isFolderAskPartiallySelected;
                          }
                        }}
                        type="checkbox"
                      />
                      <button
                        aria-expanded={isExpanded}
                        aria-selected={isSelected}
                        className={`flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1.5 text-left text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                          isDropTarget
                            ? "bg-accent-muted text-text-primary ring-1 ring-accent/40"
                            : isSelected
                              ? "bg-surface-raised text-text-primary"
                              : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                        }`}
                        onDragLeave={() => handleFolderDragLeave(folderDropTarget)}
                        onDragOver={(event) => handleFolderDragOver(event, folderDropTarget)}
                        onDrop={(event) => void handleFolderDrop(event, folderDropTarget)}
                        onClick={() => handleFolderClick(folder)}
                        title={folder.label}
                        type="button"
                      >
                        {isExpanded ? (
                          <ChevronDown
                            aria-hidden="true"
                            className="shrink-0"
                            size={14}
                            strokeWidth={2}
                          />
                        ) : (
                          <ChevronRight
                            aria-hidden="true"
                            className="shrink-0"
                            size={14}
                            strokeWidth={2}
                          />
                        )}
                        <FolderIcon aria-hidden="true" className="shrink-0" size={14} strokeWidth={2} />
                        <span className="min-w-0 flex-1 truncate">{folder.label}</span>
                        <span aria-hidden="true" className="shrink-0 text-[10px] tabular-nums text-text-muted">
                          {folder.notes.length}
                        </span>
                      </button>
                    </div>

                    {isExpanded ? (
                      <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-1.5" role="group">
                        {folder.notes.length > 0 ? (
                          folder.notes.map((note) => (
                            <div className="relative" key={note.id}>
                              <button
                                aria-selected={note.id === selectedNoteId}
                                className={`group flex w-full cursor-grab items-center gap-1.5 rounded-md border px-2 py-1.5 pr-8 text-left transition-colors active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                                  note.id === selectedNoteId
                                    ? "border-border-strong bg-surface-hover"
                                    : "border-transparent hover:bg-surface-hover"
                                }`}
                                draggable
                                onClick={() => selectNote(note.id)}
                                onDragEnd={clearNoteDrag}
                                onDragStart={(event) => handleNoteDragStart(event, note.id)}
                                title="Drag to move note"
                                type="button"
                              >
                                <FileText
                                  aria-hidden="true"
                                  className={`shrink-0 ${
                                    note.id === selectedNoteId ? "text-accent" : "text-text-muted"
                                  }`}
                                  size={13}
                                  strokeWidth={2}
                                />
                                <span
                                  className={`min-w-0 flex-1 truncate text-[13px] font-medium ${
                                    note.id === selectedNoteId ? "text-accent" : "text-text-primary"
                                  }`}
                                >
                                  {note.ai_title}
                                </span>
                                <time
                                  className="shrink-0 text-[10px] tabular-nums text-text-muted"
                                  dateTime={note.date_added}
                                >
                                  {note.date_added.slice(5, 10)}
                                </time>
                              </button>
                              <input
                                aria-label={`Use ${note.ai_title} for Ask`}
                                checked={isNoteSelectedForAsk(askNoteScope, note.id)}
                                className="absolute right-2.5 top-2 h-3 w-3 rounded border-border bg-surface-raised accent-accent opacity-70 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                                onChange={(event) => {
                                  event.stopPropagation();
                                  handleToggleAskNoteScope(note.id);
                                }}
                                onClick={(event) => event.stopPropagation()}
                                type="checkbox"
                              />
                            </div>
                          ))
                        ) : (
                          <p className="px-2 py-1.5 text-[11px] text-text-muted">No notes</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
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
          scopeLabel={askChatScopeLabel}
          submitDisabledMessage={isAskNoteScopeEmpty ? "Select at least one source for Ask." : undefined}
        />
      </aside>
    </div>
  );
}
