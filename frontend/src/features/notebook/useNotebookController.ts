import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from "react";

import {
  createCategory as createCategoryRequest,
  createNote,
  deleteCategory as deleteCategoryRequest,
  deleteNote as deleteNoteRequest,
  getNote,
  listCategories,
  listNotes,
  organizeNote,
  updateCategory as updateCategoryRequest,
  updateNote,
} from "../../api";
import type { NoteWorkspaceMode } from "../../components/NoteWorkspace";
import {
  createBlankNoteEditorDocument,
  parseDraftNoteEditorDocument,
} from "../../editor/noteEditorDocument";
import type { AppMode } from "../../hooks/useKeyboardShortcuts";
import type { Category, Note, NoteUpdate } from "../../types";

export type CategoryFilter = "all" | "uncategorized" | number;
export type SidebarTab = "browse" | "search";
export type BrowseFolder = {
  filter: Exclude<CategoryFilter, "all">;
  key: string;
  label: string;
  notes: Note[];
};
export type NoteDropTarget = {
  categoryId: number | null;
  key: string;
};

export type NotebookReconciliation = {
  deleteNotes: (noteIds: number[]) => void;
  renameCategory: (category: Category) => void;
  replaceNote: (note: Note) => void;
  uncategorizeNotes: (noteIds: number[]) => void;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function sortCategories(categories: Category[]): Category[] {
  return [...categories].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) || left.id - right.id,
  );
}

function categoryFilterKey(filter: Exclude<CategoryFilter, "all">): string {
  return filter === "uncategorized" ? "uncategorized" : `category:${filter}`;
}

export function useNotebookController(reconciliation: NotebookReconciliation) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [selectedCategoryFilter, setSelectedCategoryFilter] =
    useState<CategoryFilter>("all");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("browse");
  const [draftText, setDraftText] = useState(() => createBlankNoteEditorDocument());
  const [draftCategoryId, setDraftCategoryId] = useState<number | null>(null);
  const [categoryDraft, setCategoryDraftState] = useState("");
  const [categoryEditDraft, setCategoryEditDraftState] = useState("");
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);
  const [isLoadingNotes, setIsLoadingNotes] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isUpdatingCategory, setIsUpdatingCategory] = useState(false);
  const [deletingCategoryId, setDeletingCategoryId] = useState<number | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<NoteWorkspaceMode>("new");
  const [readMode, setReadMode] = useState(false);
  const [editResetKey, setEditResetKey] = useState(0);
  const [isSelectedNoteEditDirty, setIsSelectedNoteEditDirty] = useState(false);
  const [expandedFolderKeys, setExpandedFolderKeys] = useState<Set<string>>(() => new Set());
  const [draggedNoteId, setDraggedNoteId] = useState<number | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const draggedNoteIdRef = useRef<number | null>(null);

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
  const availableNoteIds = useMemo(() => notes.map((note) => note.id), [notes]);
  const hasUnsavedSelectedNoteEdit =
    workspaceMode === "edit-selected" && isSelectedNoteEditDirty;

  const canOpenSourceNote = useCallback((): boolean => {
    if (!hasUnsavedSelectedNoteEdit) {
      return true;
    }

    return window.confirm("Discard unsaved note changes?");
  }, [hasUnsavedSelectedNoteEdit]);

  const openSelectedNote = useCallback((noteId: number) => {
    setIsSelectedNoteEditDirty(false);
    setEditError(null);
    setSelectedNoteId(noteId);
    setWorkspaceMode("edit-selected");
  }, []);

  const selectNote = useCallback(
    (noteId: number): boolean => {
      if (!canOpenSourceNote()) {
        return false;
      }

      openSelectedNote(noteId);
      return true;
    },
    [canOpenSourceNote, openSelectedNote],
  );

  const openSourceNote = useCallback(
    (noteId: number) => {
      const sourceNote = notes.find((note) => note.id === noteId);
      if (sourceNote) {
        setCategoryError(null);
        setSelectedCategoryFilter(sourceNote.category?.id ?? "uncategorized");
        setDraftCategoryId(sourceNote.category?.id ?? null);
      }
      openSelectedNote(noteId);
    },
    [notes, openSelectedNote],
  );

  const handleModeChange = useCallback(
    (nextMode: AppMode) => {
      if (nextMode === "capture") {
        setWorkspaceMode("new");
      } else if (nextMode === "search") {
        setSidebarTab("search");
        if (selectedNoteId !== null) {
          setWorkspaceMode("edit-selected");
        }
      }
    },
    [selectedNoteId],
  );

  const changeCategoryFilter = useCallback(
    (filter: CategoryFilter): boolean => {
      if (!canOpenSourceNote()) {
        return false;
      }

      setSelectedCategoryFilter(filter);
      setCategoryError(null);
      setEditError(null);
      setIsSelectedNoteEditDirty(false);
      if (typeof filter === "number") {
        setDraftCategoryId(filter);
      } else if (filter === "uncategorized") {
        setDraftCategoryId(null);
      }
      return true;
    },
    [canOpenSourceNote],
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

  const clickFolder = useCallback(
    (folder: BrowseFolder): boolean => {
      const accepted = changeCategoryFilter(folder.filter);
      toggleFolder(folder.key);
      return accepted;
    },
    [changeCategoryFilter, toggleFolder],
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

  const startNoteDrag = useCallback(
    (event: DragEvent<HTMLButtonElement>, noteId: number) => {
      if (!canOpenSourceNote()) {
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
    [canOpenSourceNote, clearNoteDrag, hasUnsavedSelectedNoteEdit],
  );

  const dragOverFolder = useCallback(
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

  const dragLeaveFolder = useCallback((target: NoteDropTarget) => {
    setDropTargetKey((currentKey) => (currentKey === target.key ? null : currentKey));
  }, []);

  const dropNoteOnFolder = useCallback(
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
        reconciliation.replaceNote(savedNote);
        setSelectedNote((currentNote) =>
          currentNote?.id === savedNote.id ? savedNote : currentNote,
        );
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
    [clearNoteDrag, draggedNoteId, notes, reconciliation, selectedNoteId],
  );

  useEffect(() => {
    let ignore = false;
    async function loadInitialData() {
      setIsLoadingNotes(true);
      setListError(null);
      setCategoryError(null);
      try {
        const [loadedNotes, loadedCategories] = await Promise.all([listNotes(), listCategories()]);
        if (ignore) return;
        setNotes(loadedNotes);
        setCategories(loadedCategories);
        setExpandedFolderKeys(new Set());
        setSelectedNoteId(null);
        setSelectedNote(null);
      } catch (error) {
        if (ignore) return;
        setListError(getErrorMessage(error, "Couldn't open your notebook."));
        setNotes([]);
        setCategories([]);
        setSelectedNoteId(null);
        setSelectedNote(null);
      } finally {
        if (!ignore) setIsLoadingNotes(false);
      }
    }
    void loadInitialData();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (selectedNoteId === null) return;
    const noteId = selectedNoteId;
    let ignore = false;
    async function loadSelectedNote() {
      setIsLoadingDetail(true);
      setDetailError(null);
      setDeleteError(null);
      try {
        const loadedNote = await getNote(noteId);
        if (!ignore) setSelectedNote(loadedNote);
      } catch (error) {
        if (!ignore) {
          setSelectedNote(null);
          setDetailError(getErrorMessage(error, "Couldn't open this note."));
        }
      } finally {
        if (!ignore) setIsLoadingDetail(false);
      }
    }
    void loadSelectedNote();
    return () => {
      ignore = true;
    };
  }, [selectedNoteId]);

  const setCategoryDraft = useCallback((value: string) => {
    setCategoryDraftState(value);
    setCategoryError(null);
  }, []);

  const setCategoryEditDraft = useCallback((value: string) => {
    setCategoryEditDraftState(value);
    setCategoryError(null);
  }, []);

  const toggleCategoryManager = useCallback(() => {
    setIsCategoryManagerOpen((current) => !current);
    setCategoryError(null);
  }, []);

  const startCategoryRename = useCallback((category: Category) => {
    setEditingCategoryId(category.id);
    setCategoryEditDraftState(category.name);
    setCategoryError(null);
  }, []);

  const cancelCategoryRename = useCallback(() => {
    setEditingCategoryId(null);
    setCategoryEditDraftState("");
    setCategoryError(null);
  }, []);

  const createCategory = useCallback(async (): Promise<boolean> => {
    const name = categoryDraft.trim();
    if (!name) {
      setCategoryError("Enter a category name.");
      return false;
    }
    setIsSavingCategory(true);
    setCategoryError(null);
    try {
      const category = await createCategoryRequest(name);
      setCategories((currentCategories) => sortCategories([...currentCategories, category]));
      setCategoryDraftState("");
      setSelectedCategoryFilter(category.id);
      setDraftCategoryId(category.id);
      setSelectedNote(null);
      setSelectedNoteId(null);
      setExpandedFolderKeys((currentKeys) =>
        new Set(currentKeys).add(categoryFilterKey(category.id)),
      );
      return true;
    } catch (error) {
      setCategoryError(getErrorMessage(error, "Couldn't create the category."));
      return false;
    } finally {
      setIsSavingCategory(false);
    }
  }, [categoryDraft]);

  const renameCategory = useCallback(
    async (categoryId: number): Promise<void> => {
      const name = categoryEditDraft.trim();
      if (!name) {
        setCategoryError("Enter a category name.");
        return;
      }
      setIsUpdatingCategory(true);
      setCategoryError(null);
      try {
        const category = await updateCategoryRequest(categoryId, name);
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
        reconciliation.renameCategory(category);
        setSelectedNote((currentNote) =>
          currentNote?.category?.id === category.id ? { ...currentNote, category } : currentNote,
        );
        setEditingCategoryId(null);
        setCategoryEditDraftState("");
      } catch (error) {
        setCategoryError(getErrorMessage(error, "Couldn't rename the category."));
      } finally {
        setIsUpdatingCategory(false);
      }
    },
    [categoryEditDraft, reconciliation],
  );

  const deleteCategory = useCallback(
    async (category: Category, noteCount: number): Promise<void> => {
      const noteLabel = noteCount === 1 ? "1 note" : `${noteCount} notes`;
      if (!window.confirm(`Delete "${category.name}" and uncategorize its ${noteLabel}?`)) return;
      setDeletingCategoryId(category.id);
      setCategoryError(null);
      try {
        const result = await deleteCategoryRequest(category.id);
        const deletedNoteIds = new Set(result.deleted_note_ids);
        const uncategorizedNoteIds = new Set(result.uncategorized_note_ids);
        setCategories((currentCategories) =>
          currentCategories.filter((currentCategory) => currentCategory.id !== category.id),
        );
        setNotes((currentNotes) =>
          currentNotes
            .filter((note) => !deletedNoteIds.has(note.id))
            .map((note) =>
              uncategorizedNoteIds.has(note.id) ? { ...note, category: null } : note,
            ),
        );
        reconciliation.deleteNotes(result.deleted_note_ids);
        reconciliation.uncategorizeNotes(result.uncategorized_note_ids);
        setExpandedFolderKeys((currentKeys) => {
          const nextKeys = new Set(currentKeys);
          nextKeys.delete(categoryFilterKey(category.id));
          return nextKeys;
        });
        if (selectedCategoryFilter === category.id) setSelectedCategoryFilter("all");
        if (draftCategoryId === category.id) setDraftCategoryId(null);
        setSelectedNote((currentNote) =>
          currentNote?.category?.id === category.id ? { ...currentNote, category: null } : currentNote,
        );
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
          setCategoryEditDraftState("");
        }
      } catch (error) {
        setCategoryError(getErrorMessage(error, "Couldn't delete the category."));
      } finally {
        setDeletingCategoryId(null);
      }
    },
    [
      draftCategoryId,
      editingCategoryId,
      reconciliation,
      selectedCategoryFilter,
      selectedNoteId,
    ],
  );

  const createCategoryFromEditor = useCallback(async (name: string) => {
    const category = await createCategoryRequest(name);
    setCategories((currentCategories) => sortCategories([...currentCategories, category]));
    setExpandedFolderKeys((currentKeys) =>
      new Set(currentKeys).add(categoryFilterKey(category.id)),
    );
    setCategoryError(null);
    return category;
  }, []);

  const saveNote = useCallback(async (): Promise<boolean> => {
    const parsedDraft = parseDraftNoteEditorDocument(draftText, categories);
    if (!parsedDraft.update.original_text.trim()) {
      setSaveError("Enter note text before saving.");
      return false;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      let categoryId = parsedDraft.update.category_id ?? draftCategoryId;
      if (parsedDraft.categoryNameToCreate) {
        const category = await createCategoryFromEditor(parsedDraft.categoryNameToCreate);
        categoryId = category.id;
      }
      const savedNote = await createNote({ ...parsedDraft.update, category_id: categoryId });
      setNotes((currentNotes) => [
        savedNote,
        ...currentNotes.filter((note) => note.id !== savedNote.id),
      ]);
      setSelectedCategoryFilter(savedNote.category?.id ?? "uncategorized");
      setDraftText(createBlankNoteEditorDocument());
      setSelectedNote(savedNote);
      setSelectedNoteId(savedNote.id);
      setWorkspaceMode("edit-selected");
      return true;
    } catch (error) {
      setSaveError(getErrorMessage(error, "Couldn't save the note."));
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [categories, createCategoryFromEditor, draftCategoryId, draftText]);

  const onDraftTextChange = useCallback((value: string) => {
    setDraftText(value);
    setSaveError(null);
  }, []);

  const newNote = useCallback((): boolean => {
    if (!canOpenSourceNote()) return false;
    setIsSelectedNoteEditDirty(false);
    setSelectedNoteId(null);
    setSelectedNote(null);
    setDetailError(null);
    setDeleteError(null);
    setEditError(null);
    setWorkspaceMode("new");
    return true;
  }, [canOpenSourceNote]);

  const newNoteForCategory = useCallback(
    (categoryId: number): boolean => {
      if (!newNote()) return false;
      const category = categories.find((currentCategory) => currentCategory.id === categoryId);
      setDraftText(createBlankNoteEditorDocument(category?.name));
      setDraftCategoryId(categoryId);
      setSelectedCategoryFilter(categoryId);
      setSaveError(null);
      return true;
    },
    [categories, newNote],
  );

  const editSelectedNote = useCallback(() => {
    if (!selectedNote) return;
    setEditError(null);
    setReadMode(false);
    setWorkspaceMode("edit-selected");
  }, [selectedNote]);

  const cancelSelectedNoteEdit = useCallback(() => {
    setIsSelectedNoteEditDirty(false);
    setEditError(null);
    setReadMode(false);
    setWorkspaceMode("edit-selected");
    setEditResetKey((currentKey) => currentKey + 1);
  }, []);

  const regenerateSelectedNoteDetails = useCallback((bodyText: string) => organizeNote(bodyText), []);

  const saveSelectedNoteEdit = useCallback(
    async (body: NoteUpdate): Promise<void> => {
      if (!selectedNote) return;
      setIsSavingEdit(true);
      setEditError(null);
      try {
        const savedNote = await updateNote(selectedNote.id, body);
        setSelectedNote(savedNote);
        setNotes((currentNotes) =>
          currentNotes.map((note) => (note.id === savedNote.id ? savedNote : note)),
        );
        reconciliation.replaceNote(savedNote);
        setSelectedCategoryFilter(savedNote.category?.id ?? "uncategorized");
        setDraftCategoryId(savedNote.category?.id ?? null);
        setIsSelectedNoteEditDirty(false);
        setWorkspaceMode("edit-selected");
      } catch (error) {
        setEditError(getErrorMessage(error, "Couldn't save your changes."));
      } finally {
        setIsSavingEdit(false);
      }
    },
    [reconciliation, selectedNote],
  );

  const deleteNote = useCallback(
    async (noteId: number): Promise<void> => {
      const title = selectedNote?.id === noteId ? selectedNote.ai_title : "this note";
      if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;
      setIsDeleting(true);
      setDeleteError(null);
      try {
        await deleteNoteRequest(noteId);
        setNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId));
        reconciliation.deleteNotes([noteId]);
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
    },
    [reconciliation, selectedNote],
  );

  const toggleReadMode = useCallback(() => setReadMode((currentMode) => !currentMode), []);

  return {
    availableNoteIds,
    browseFolders,
    canOpenSourceNote,
    cancelCategoryRename,
    cancelSelectedNoteEdit,
    categories,
    categoryDraft,
    categoryEditDraft,
    categoryError,
    changeCategoryFilter,
    clearNoteDrag,
    clickFolder,
    createCategory,
    createCategoryFromEditor,
    deleteCategory,
    deleteError,
    deleteNote,
    deletingCategoryId,
    detailError,
    draftCategoryId,
    draftText,
    dragLeaveFolder,
    draggedNoteId,
    dragOverFolder,
    dropNoteOnFolder,
    dropTargetKey,
    editError,
    editingCategoryId,
    editResetKey,
    editSelectedNote,
    expandedFolderKeys,
    getFolderDropTarget,
    handleModeChange,
    hasUnsavedSelectedNoteEdit,
    isCategoryManagerOpen,
    isDeleting,
    isLoadingDetail,
    isLoadingNotes,
    isSaving,
    isSavingCategory,
    isSavingEdit,
    isSelectedNoteEditDirty,
    isUpdatingCategory,
    listError,
    newNote,
    newNoteForCategory,
    notes,
    onDraftTextChange,
    openSourceNote,
    readMode,
    regenerateSelectedNoteDetails,
    renameCategory,
    saveError,
    saveNote,
    saveSelectedNoteEdit,
    selectNote,
    selectedCategoryFilter,
    selectedNote,
    selectedNoteId,
    setCategoryDraft,
    setCategoryEditDraft,
    setIsSelectedNoteEditDirty,
    setSidebarTab: setSidebarTab as Dispatch<SetStateAction<SidebarTab>>,
    sidebarTab,
    sortedCategories,
    startCategoryRename,
    startNoteDrag,
    toggleCategoryManager,
    toggleReadMode,
    workspaceMode,
  };
}
