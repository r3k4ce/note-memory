import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  BookOpen,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  Maximize2,
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
  organizeNote,
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
import { ThemeMenu } from "./components/ThemeMenu";
import {
  createBlankNoteEditorDocument,
  parseDraftNoteEditorDocument,
} from "./editor/noteEditorDocument";
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
type PaneSide = "left" | "right";
type PaneResizeHandleProps = {
  className?: string;
  label: string;
  maxWidth: number;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  width: number;
};

const ASK_HISTORY_MESSAGE_LIMIT = 6;
const LEFT_PANE_DEFAULT_WIDTH = 320;
const LEFT_PANE_MIN_WIDTH = 240;
const LEFT_PANE_MAX_WIDTH = 480;
const RIGHT_PANE_DEFAULT_WIDTH = 352;
const RIGHT_PANE_MIN_WIDTH = 280;
const RIGHT_PANE_MAX_WIDTH = 448;
const PANE_COLLAPSE_THRESHOLD = 96;

function clampPaneWidth(width: number, minWidth: number, maxWidth: number): number {
  if (width < PANE_COLLAPSE_THRESHOLD) {
    return 0;
  }

  return Math.min(Math.max(width, minWidth), maxWidth);
}

function PaneResizeHandle({
  className = "flex",
  label,
  maxWidth,
  onResizeStart,
  width,
}: PaneResizeHandleProps) {
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={0}
      aria-valuenow={width}
      className={`group relative w-2 shrink-0 cursor-col-resize items-center justify-center bg-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${className}`}
      onPointerDown={onResizeStart}
      role="separator"
      tabIndex={0}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-border-strong" />
      <div className="relative flex h-8 w-3.5 items-center justify-center rounded-md bg-bg text-text-muted shadow-sm transition-colors group-hover:text-text-secondary">
        <GripVertical aria-hidden="true" size={13} strokeWidth={1.75} />
      </div>
    </div>
  );
}

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
  const [draftText, setDraftText] = useState(() => createBlankNoteEditorDocument());
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
  const [readMode, setReadMode] = useState(false);
  const [editResetKey, setEditResetKey] = useState(0);
  const [isSelectedNoteEditDirty, setIsSelectedNoteEditDirty] = useState(false);
  const [askMessages, setAskMessages] = useState<ChatMessage[]>([]);
  const [askPendingMessageId, setAskPendingMessageId] = useState<string | null>(null);
  const [askNoteScope, setAskNoteScope] = useState(DEFAULT_ASK_NOTE_SCOPE);
  const [expandedFolderKeys, setExpandedFolderKeys] = useState<Set<string>>(() => new Set());
  const [draggedNoteId, setDraggedNoteId] = useState<number | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [leftPaneWidth, setLeftPaneWidth] = useState(LEFT_PANE_DEFAULT_WIDTH);
  const [rightPaneWidth, setRightPaneWidth] = useState(RIGHT_PANE_DEFAULT_WIDTH);

  const searchRequestId = useRef(0);
  const liveSearchTimeoutId = useRef<number | null>(null);
  const askRequestId = useRef(0);
  const askMessageId = useRef(0);
  const askPendingMessageIdRef = useRef<string | null>(null);
  const draggedNoteIdRef = useRef<number | null>(null);
  const lastLeftPaneWidthRef = useRef(LEFT_PANE_DEFAULT_WIDTH);
  const lastRightPaneWidthRef = useRef(RIGHT_PANE_DEFAULT_WIDTH);
  const captureRef = useRef<MarkdownPaneHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);

  const isBrowseTab = sidebarTab === "browse";
  const isSearchTab = sidebarTab === "search";
  const isSearchActive = activeSearchQuery !== null;
  const isTextAreaPaneFocused = leftPaneWidth === 0 && rightPaneWidth === 0;
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

  const updateLeftPaneWidth = useCallback((width: number) => {
    const nextWidth = clampPaneWidth(width, LEFT_PANE_MIN_WIDTH, LEFT_PANE_MAX_WIDTH);
    if (nextWidth > 0) {
      lastLeftPaneWidthRef.current = nextWidth;
    }
    setLeftPaneWidth(nextWidth);
  }, []);

  const updateRightPaneWidth = useCallback((width: number) => {
    const nextWidth = clampPaneWidth(width, RIGHT_PANE_MIN_WIDTH, RIGHT_PANE_MAX_WIDTH);
    if (nextWidth > 0) {
      lastRightPaneWidthRef.current = nextWidth;
    }
    setRightPaneWidth(nextWidth);
  }, []);

  const startPaneResize = useCallback(
    (side: PaneSide, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);

      const startX = event.clientX;
      const startWidth = side === "left" ? leftPaneWidth : rightPaneWidth;

      function handlePointerMove(moveEvent: PointerEvent) {
        const deltaX = moveEvent.clientX - startX;
        const nextWidth = side === "left" ? startWidth + deltaX : startWidth - deltaX;

        if (side === "left") {
          updateLeftPaneWidth(nextWidth);
        } else {
          updateRightPaneWidth(nextWidth);
        }
      }

      function stopResize() {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
      }

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    },
    [leftPaneWidth, rightPaneWidth, updateLeftPaneWidth, updateRightPaneWidth],
  );

  const toggleTextAreaFocus = useCallback(() => {
    if (isTextAreaPaneFocused) {
      setLeftPaneWidth(lastLeftPaneWidthRef.current || LEFT_PANE_DEFAULT_WIDTH);
      setRightPaneWidth(lastRightPaneWidthRef.current || RIGHT_PANE_DEFAULT_WIDTH);
      return;
    }

    if (leftPaneWidth > 0) {
      lastLeftPaneWidthRef.current = leftPaneWidth;
    }
    if (rightPaneWidth > 0) {
      lastRightPaneWidthRef.current = rightPaneWidth;
    }

    setLeftPaneWidth(0);
    setRightPaneWidth(0);
  }, [isTextAreaPaneFocused, leftPaneWidth, rightPaneWidth]);

  const confirmDiscardSelectedNoteEdit = useCallback((): boolean => {
    if (!hasUnsavedSelectedNoteEdit) {
      return true;
    }

    return window.confirm("Discard unsaved note changes?");
  }, [hasUnsavedSelectedNoteEdit]);

  const handleModeChange = useCallback((nextMode: AppMode) => {
    if (nextMode === "capture") {
      setWorkspaceMode("new");
      setReadMode(false);
    } else if (nextMode === "search") {
      setSidebarTab("search");
      if (selectedNoteId !== null) {
        setWorkspaceMode("edit-selected");
      }
    }
  }, [selectedNoteId]);

  useKeyboardShortcuts(handleModeChange, { captureRef, searchRef, askRef });

  const openSelectedNote = useCallback((noteId: number) => {
    setIsSelectedNoteEditDirty(false);
    setEditError(null);
    setSelectedNoteId(noteId);
    setReadMode(false);
    setWorkspaceMode("edit-selected");
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
    if (liveSearchTimeoutId.current !== null) {
      window.clearTimeout(liveSearchTimeoutId.current);
      liveSearchTimeoutId.current = null;
    }
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
        setReadMode(false);
        setWorkspaceMode("edit-selected");
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
        setCategoryError(getErrorMessage(error, "Couldn't move the note."));
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
    const query = searchText.trim();
    if (!isSearchTab || !query) {
      return;
    }

    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    setActiveSearchQuery(query);
    setSearchResults([]);
    setSearchError(null);
    setIsSearching(true);

    liveSearchTimeoutId.current = window.setTimeout(() => {
      liveSearchTimeoutId.current = null;
      void (async () => {
        try {
          const results = await searchNotes(query, { semantic: false });
          if (searchRequestId.current === requestId) {
            setSearchResults(results);
          }
        } catch (error) {
          if (searchRequestId.current === requestId) {
            setSearchResults([]);
            setSearchError(getErrorMessage(error, "Couldn't search your notes."));
          }
        } finally {
          if (searchRequestId.current === requestId) {
            setIsSearching(false);
          }
        }
      })();
    }, 300);

    return () => {
      if (liveSearchTimeoutId.current !== null) {
        window.clearTimeout(liveSearchTimeoutId.current);
        liveSearchTimeoutId.current = null;
      }
    };
  }, [isSearchTab, searchText]);

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

        setListError(getErrorMessage(error, "Couldn't open your notebook."));
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
          setDetailError(getErrorMessage(error, "Couldn't open this note."));
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

    if (liveSearchTimeoutId.current !== null) {
      window.clearTimeout(liveSearchTimeoutId.current);
      liveSearchTimeoutId.current = null;
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
        setSearchError(getErrorMessage(error, "Couldn't search your notes."));
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
      content: "Bun is finding notes...\nBun is checking snippets...\nBun is writing...",
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
                  status: result.status,
                  evidenceSummary: result.evidence_summary,
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
                  content: getErrorMessage(error, "Bun couldn't reach your notes."),
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
      setCategoryError(getErrorMessage(error, "Couldn't create the category."));
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
      setCategoryError(getErrorMessage(error, "Couldn't rename the category."));
    } finally {
      setIsUpdatingCategory(false);
    }
  }

  async function handleDeleteCategory(category: Category, noteCount: number) {
    const noteLabel = noteCount === 1 ? "1 note" : `${noteCount} notes`;
    if (!window.confirm(`Delete "${category.name}" and uncategorize its ${noteLabel}?`)) {
      return;
    }

    setDeletingCategoryId(category.id);
    setCategoryError(null);

    try {
      const result = await deleteCategory(category.id);
      const deletedNoteIds = new Set(result.deleted_note_ids);
      const uncategorizedNoteIds = new Set(result.uncategorized_note_ids);
      setCategories((currentCategories) =>
        currentCategories.filter((currentCategory) => currentCategory.id !== category.id),
      );
      setNotes((currentNotes) =>
        currentNotes
          .filter((note) => !deletedNoteIds.has(note.id))
          .map((note) => (uncategorizedNoteIds.has(note.id) ? { ...note, category: null } : note)),
      );
      setSearchResults((currentResults) =>
        currentResults
          .filter((result) => !deletedNoteIds.has(result.id))
          .map((result) => (uncategorizedNoteIds.has(result.id) ? { ...result, category: null } : result)),
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
      if (selectedNote?.category?.id === category.id) {
        setSelectedNote({ ...selectedNote, category: null });
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
      setCategoryError(getErrorMessage(error, "Couldn't delete the category."));
    } finally {
      setDeletingCategoryId(null);
    }
  }

  async function handleSaveNote() {
    const parsedDraft = parseDraftNoteEditorDocument(draftText, categories);
    if (!parsedDraft.update.original_text.trim()) {
      setSaveError("Enter note text before saving.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      let categoryId = parsedDraft.update.category_id ?? draftCategoryId;
      if (parsedDraft.categoryNameToCreate) {
        const category = await handleCreateCategoryFromEditor(parsedDraft.categoryNameToCreate);
        categoryId = category.id;
      }

      const savedNote = await createNote({
        ...parsedDraft.update,
        category_id: categoryId,
      });
      clearSearch();
      setNotes((currentNotes) => [savedNote, ...currentNotes.filter((note) => note.id !== savedNote.id)]);
      setSelectedCategoryFilter(savedNote.category?.id ?? "uncategorized");
      setDraftText(createBlankNoteEditorDocument());
      setSelectedNote(savedNote);
      setSelectedNoteId(savedNote.id);
      setReadMode(false);
      setWorkspaceMode("edit-selected");
    } catch (error) {
      setSaveError(getErrorMessage(error, "Couldn't save the note."));
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
    setReadMode(false);
    setWorkspaceMode("new");
  }, [confirmDiscardSelectedNoteEdit]);

  const handleEditSelectedNote = useCallback(() => {
    if (!selectedNote) {
      return;
    }

    setEditError(null);
    setReadMode(false);
    setWorkspaceMode("edit-selected");
  }, [selectedNote]);

  const handleCancelEditSelectedNote = useCallback(() => {
    setIsSelectedNoteEditDirty(false);
    setEditError(null);
    setReadMode(false);
    setWorkspaceMode("edit-selected");
    setEditResetKey((currentKey) => currentKey + 1);
  }, []);

  const handleCreateCategoryFromEditor = useCallback(async (name: string) => {
    const category = await createCategory(name);
    setCategories((currentCategories) => sortCategories([...currentCategories, category]));
    setExpandedFolderKeys((currentKeys) => new Set(currentKeys).add(categoryFilterKey(category.id)));
    setCategoryError(null);

    return category;
  }, []);

  const handleRegenerateSelectedNoteDetails = useCallback(async (bodyText: string) => {
    return organizeNote(bodyText);
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
      setReadMode(false);
      setWorkspaceMode("edit-selected");
    } catch (error) {
      setEditError(getErrorMessage(error, "Couldn't save your changes."));
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
      setDeleteError(getErrorMessage(error, "Couldn't delete the note."));
    } finally {
      setIsDeleting(false);
    }
  }

  const searchStatus = isSearching
    ? "Bun is searching..."
    : searchError
      ? "Search hit a snag"
      : searchResults.length === 0
        ? "No crumbs found"
        : searchResults.length === 1
          ? "1 match"
          : `${searchResults.length} matches`;
  const toolbarControls = (
    <>
      <button
        aria-label={readMode ? "Edit Mode" : "Read Mode"}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        onClick={() => setReadMode((currentMode) => !currentMode)}
        title={readMode ? "Edit Mode" : "Read Mode"}
        type="button"
      >
        {readMode ? (
          <Pencil aria-hidden="true" size={15} strokeWidth={2} />
        ) : (
          <BookOpen aria-hidden="true" size={15} strokeWidth={2} />
        )}
      </button>
      <button
        aria-label={isTextAreaPaneFocused ? "Exit" : "Focus Mode"}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        onClick={toggleTextAreaFocus}
        title={isTextAreaPaneFocused ? "Exit" : "Focus Mode"}
        type="button"
      >
        <Maximize2 aria-hidden="true" size={15} strokeWidth={2} />
      </button>
    </>
  );

  return (
    <div className="flex h-screen bg-bg text-text-primary">
      <aside
        aria-label="Notes sidebar"
        className="flex shrink-0 flex-col overflow-hidden bg-bg transition-[width] duration-150 ease-out"
        style={{ width: leftPaneWidth }}
      >
        <div className="shrink-0 border-b border-border px-3 py-6">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="text-lg font-semibold tracking-tight text-text-primary">Notebun</span>
            <span className="ml-auto">
              <ThemeMenu />
            </span>
          </div>
        </div>

        <div className="shrink-0 px-3 py-2.5">
          <button
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-3 text-[14px] font-semibold text-black shadow-soft transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isSaving || isSavingEdit || isDeleting}
            onClick={handleNewNote}
            type="button"
          >
            <Plus size={16} strokeWidth={2} />
            New note
          </button>
        </div>

        <div className="shrink-0 px-3 py-2.5">
          <div
            aria-label="Sidebar mode"
            className="grid grid-cols-2 rounded-md bg-surface p-1"
            role="tablist"
          >
            <button
              aria-selected={isBrowseTab}
              className={`rounded px-3 py-3 text-[14px] transition-colors ${
                isBrowseTab
                  ? "bg-bg text-accent shadow-soft font-semibold"
                  : "text-text-muted hover:text-text-primary font-medium"
              }`}
              onClick={() => setSidebarTab("browse")}
              role="tab"
              type="button"
            >
              Browse
            </button>
            <button
              aria-selected={isSearchTab}
              className={`rounded px-3 py-3 text-[14px] transition-colors ${
                isSearchTab
                  ? "bg-bg text-accent shadow-soft font-semibold"
                  : "text-text-muted hover:text-text-primary font-medium"
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
          <div className="shrink-0 px-3 py-2.5">
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
                <span className="min-w-0 truncate text-xs text-text-secondary">
                  Results for “{activeSearchQuery}”
                </span>
                <span className="shrink-0 text-xs tabular-nums text-text-muted">
                  {searchStatus}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {isBrowseTab ? (
          <div className="shrink-0 px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <button
                aria-expanded={isCategoryManagerOpen}
                className="inline-flex min-w-0 items-center gap-1 rounded-md px-2 py-1.5 text-[14px] font-semibold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
                onClick={() => {
                  setIsCategoryManagerOpen((current) => !current);
                  setCategoryError(null);
                }}
                type="button"
              >
                {isCategoryManagerOpen ? (
                  <ChevronDown aria-hidden="true" size={16} strokeWidth={2} />
                ) : (
                  <ChevronRight aria-hidden="true" size={16} strokeWidth={2} />
                )}
                Categories
              </button>
              <span className="shrink-0 text-[11px] text-text-muted">{askScopeSummary}</span>
            </div>

            {isCategoryManagerOpen ? (
              <div
                aria-label="Manage categories"
                className="mt-2 rounded-md bg-surface p-2"
                role="region"
              >
                <form className="flex gap-1.5" onSubmit={handleCreateCategory}>
                  <input
                    aria-label="New category name"
                    className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-2 text-[13px] text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface disabled:opacity-60"
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
                    className="inline-flex items-center justify-center rounded-md bg-accent px-2.5 py-2 text-black transition-colors hover:bg-accent-hover disabled:opacity-40"
                    disabled={isSavingCategory}
                    type="submit"
                  >
                    <Plus size={14} strokeWidth={2} />
                  </button>
                </form>

                {sortedCategories.length > 0 ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {sortedCategories.map((category) => {
                      const noteCount = notes.filter((note) => note.category?.id === category.id).length;
                      const isEditingCategory = editingCategoryId === category.id;

                      return (
                        <div className="rounded bg-bg px-2.5 py-2.5" key={category.id}>
                          {isEditingCategory ? (
                            <form
                              className="flex gap-1.5"
                              onSubmit={(event) => handleRenameCategory(event, category.id)}
                            >
                              <input
                                aria-label="Category name"
                                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-[13px] text-text-primary outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
                                disabled={isUpdatingCategory}
                                onChange={(event) => {
                                  setCategoryEditDraft(event.target.value);
                                  setCategoryError(null);
                                }}
                                value={categoryEditDraft}
                              />
                              <button
                                aria-label="Save category"
                                className="rounded p-1.5 text-accent transition-colors hover:bg-surface-hover disabled:opacity-40"
                                disabled={isUpdatingCategory}
                                type="submit"
                              >
                                <Check size={14} strokeWidth={2} />
                              </button>
                              <button
                                aria-label="Cancel category rename"
                                className="rounded p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text-secondary disabled:opacity-40"
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
                              <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                                {noteCount}
                              </span>
                              <button
                                aria-label={`Rename ${category.name}`}
                                className="rounded p-1.5 text-text-muted transition-colors hover:bg-surface hover:text-text-secondary disabled:opacity-40"
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
                                className="rounded p-1.5 text-text-muted transition-colors hover:bg-error-muted hover:text-error disabled:opacity-40"
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

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 pt-1">
          {isBrowseTab && isLoadingNotes ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-text-muted">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
              Opening your notebook...
            </div>
          ) : null}

          {isSearchTab && isSearching ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-text-muted">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
              Bun is searching...
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
              <p className="text-xs text-text-muted">Your notebook is empty.</p>
              <p className="mt-1 text-xs text-text-muted">
                Press <kbd className="rounded bg-surface px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">{APP_SHORTCUTS.capture.label}</kbd> to create your first note
              </p>
            </div>
          ) : null}
          {isSearchTab && isSearchActive && !isSearching && !searchError && searchResults.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-text-muted">No crumbs found.</p>
          ) : null}

          {isSearchTab && isSearchActive ? (
            <div className="flex flex-col gap-2">
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
            <div aria-label="Browse notes" className="flex flex-col gap-1" role="tree">
              <div className="flex items-center gap-1 rounded-md pr-1">
                <input
                  aria-label="Use all notes for Ask"
                  checked={askNoteScope.mode === "all"}
                  className="ml-2.5 h-4 w-4 shrink-0 rounded border-border bg-surface accent-accent opacity-75 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                  onChange={handleToggleAllAskNotes}
                  type="checkbox"
                />
                <button
                  aria-selected={selectedCategoryFilter === "all"}
                  className={`sidebar-row flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                    selectedCategoryFilter === "all"
                      ? "bg-surface text-text-primary"
                      : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                  }`}
                  onClick={() => handleCategoryFilterChange("all")}
                  type="button"
                >
                  <FileText aria-hidden="true" className="shrink-0" size={16} strokeWidth={2} />
                  <span className="min-w-0 flex-1 truncate">All notes</span>
                  <span aria-hidden="true" className="shrink-0 text-[12px] tabular-nums text-text-muted">
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
                  <div className="flex flex-col gap-1" key={folder.key}>
                    <div className="flex items-center gap-1 rounded-md pr-1">
                      <input
                        aria-label={`Use ${folder.label} category for Ask`}
                        checked={isFolderAskSelected}
                        className="ml-2.5 h-3.5 w-3.5 shrink-0 rounded border-border bg-surface accent-accent opacity-75 transition-opacity hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
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
                        className={`sidebar-row flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                          isDropTarget
                            ? "bg-accent-muted text-text-primary ring-1 ring-accent/40"
                            : isSelected
                              ? "bg-surface text-text-primary"
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
                            size={16}
                            strokeWidth={2}
                          />
                        ) : (
                          <ChevronRight
                            aria-hidden="true"
                            className="shrink-0"
                            size={16}
                            strokeWidth={2}
                          />
                        )}
                        <FolderIcon aria-hidden="true" className="shrink-0" size={16} strokeWidth={2} />
                        <span className="min-w-0 flex-1 truncate">{folder.label}</span>
                        <span aria-hidden="true" className="shrink-0 text-[12px] tabular-nums text-text-muted">
                          {folder.notes.length}
                        </span>
                      </button>
                    </div>

                    {isExpanded ? (
                      <div className="ml-4 flex flex-col gap-1.5 pl-1.5" role="group">
                        {folder.notes.length > 0 ? (
                          folder.notes.map((note) => (
                            <NoteCard
                              askScopeSelected={isNoteSelectedForAsk(askNoteScope, note.id)}
                              draggable
                              icon={FileText}
                              key={note.id}
                              mode="browse"
                              note={note}
                              onAskScopeToggle={handleToggleAskNoteScope}
                              onDragEnd={clearNoteDrag}
                              onDragStart={(event) => handleNoteDragStart(event, note.id)}
                              onSelect={selectNote}
                              selected={note.id === selectedNoteId}
                              showAskScopeCheckbox
                            />
                          ))
                        ) : (
                          <p className="px-2 py-2 text-xs text-text-muted">Nothing here yet</p>
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

      <PaneResizeHandle
        label="Resize notes sidebar"
        maxWidth={LEFT_PANE_MAX_WIDTH}
        onResizeStart={(event) => startPaneResize("left", event)}
        width={leftPaneWidth}
      />

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg">
        <div className="min-h-0 flex-1 overflow-hidden">
          <NoteWorkspace
            captureRef={captureRef}
            categories={categories}
            deleteError={deleteError}
            draftText={draftText}
            error={detailError}
            isDeleting={isDeleting}
            isLoading={isLoadingDetail}
            isSavingEdit={isSavingEdit}
            isSaving={isSaving}
            mode={workspaceMode}
            note={selectedNote}
            editError={editError}
            editResetKey={editResetKey}
            onCancelEdit={handleCancelEditSelectedNote}
            onCreateCategoryName={handleCreateCategoryFromEditor}
            onDelete={handleDeleteNote}
            onDraftTextChange={(value) => {
              setDraftText(value);
              if (saveError) {
                setSaveError(null);
              }
            }}
            onEdit={handleEditSelectedNote}
            onEditDirtyChange={setIsSelectedNoteEditDirty}
            onNewNote={handleNewNote}
            onRegenerateDetails={handleRegenerateSelectedNoteDetails}
            onSave={handleSaveNote}
            onSaveEdit={handleSaveSelectedNoteEdit}
            readMode={readMode}
            saveError={saveError}
            toolbarControls={toolbarControls}
          />
        </div>
      </main>

      <PaneResizeHandle
        className="hidden lg:flex"
        label="Resize Bun"
        maxWidth={RIGHT_PANE_MAX_WIDTH}
        onResizeStart={(event) => startPaneResize("right", event)}
        width={rightPaneWidth}
      />

      <aside
        aria-label="Bun pane"
        className={`hidden min-h-0 shrink-0 overflow-hidden bg-bg py-4 transition-[width,padding] duration-150 ease-out lg:flex ${
          rightPaneWidth === 0 ? "px-0" : "px-4"
        }`}
        style={{ width: rightPaneWidth }}
      >
        <AskChat
          askRef={askRef}
          messages={askMessages}
          onSourceSelect={handleAskSourceSelect}
          onSubmit={handleAskSubmit}
          pendingMessageId={askPendingMessageId}
          isSubmitDisabled={isAskNoteScopeEmpty}
          scopeLabel={askChatScopeLabel}
          submitDisabledMessage={isAskNoteScopeEmpty ? "Pick at least one note for Bun." : undefined}
        />
      </aside>
    </div>
  );
}
