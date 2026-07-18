import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  BookOpen,
  Maximize,
  Maximize2,
  Minimize2,
  Pencil,
} from "lucide-react";

import { NoteWorkspace } from "./components/NoteWorkspace";
import { TOOLBAR_BUTTON_CLASS } from "./components/NoteToolbar";
import { AskChat } from "./features/ask/AskChat";
import { useAskController } from "./features/ask/useAskController";
import { PaneResizeHandle } from "./features/layout/PaneResizeHandle";
import {
  LEFT_PANE_MAX_WIDTH,
  RIGHT_PANE_MAX_WIDTH,
  useWorkspaceLayout,
} from "./features/layout/useWorkspaceLayout";
import {
  useNotebookController,
  type CategoryFilter,
  type SidebarTab,
} from "./features/notebook/useNotebookController";
import { NotesSidebar } from "./features/notebook/NotesSidebar";
import { useSearchController } from "./features/notebook/useSearchController";
import { APP_SHORTCUTS, useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { MarkdownPaneHandle } from "./components/MarkdownPane";

export default function App() {
  const {
    activeQuery: activeSearchQuery,
    clear: clearSearch,
    deleteNotes: deleteSearchNotes,
    error: searchError,
    isSearching,
    onQueryChange: handleSearchTextChange,
    pauseLiveSearch,
    query: searchText,
    renameCategory: renameSearchCategory,
    replaceNote: replaceSearchNote,
    results: searchResults,
    resumeLiveSearch,
    submit: handleSearchSubmit,
    uncategorizeNotes: uncategorizeSearchNotes,
  } = useSearchController();
  const notebookReconciliation = useMemo(
    () => ({
      deleteNotes: deleteSearchNotes,
      renameCategory: renameSearchCategory,
      replaceNote: replaceSearchNote,
      uncategorizeNotes: uncategorizeSearchNotes,
    }),
    [deleteSearchNotes, renameSearchCategory, replaceSearchNote, uncategorizeSearchNotes],
  );
  const notebook = useNotebookController(notebookReconciliation);
  const {
    activeResizeSide,
    gripPositions,
    isFocusEditorShrunk,
    isTextAreaPaneFocused,
    leftPaneClassName,
    leftPaneWidth,
    leftSidebarRef,
    markdownSurfaceRef,
    preFocusCenterWidth,
    rightPaneClassName,
    rightPaneWidth,
    rightSidebarRef,
    setIsFocusEditorShrunk,
    snappedResizeSide,
    startPaneResize,
    toggleTextAreaFocus,
    workspaceCenterContentRef,
    workspaceRootRef,
  } = useWorkspaceLayout();

  const captureRef = useRef<MarkdownPaneHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const {
    availableNoteIds,
    browseFolders,
    canOpenSourceNote,
    cancelCategoryRename,
    cancelSelectedNoteEdit: handleCancelEditSelectedNote,
    categories,
    categoryDraft,
    categoryEditDraft,
    categoryError,
    changeCategoryFilter: changeNotebookCategoryFilter,
    clearNoteDrag,
    clickFolder: clickNotebookFolder,
    createCategory: createNotebookCategory,
    createCategoryFromEditor: handleCreateCategoryFromEditor,
    deleteCategory: handleDeleteCategory,
    deleteError,
    deleteNote: handleDeleteNote,
    deletingCategoryId,
    detailError,
    draftText,
    dragLeaveFolder: handleFolderDragLeave,
    dragOverFolder: handleFolderDragOver,
    dropNoteOnFolder: handleFolderDrop,
    dropTargetKey,
    editError,
    editingCategoryId,
    editResetKey,
    editSelectedNote: handleEditSelectedNote,
    expandedFolderKeys,
    getFolderDropTarget,
    handleModeChange,
    isCategoryManagerOpen,
    isDeleting,
    isLoadingDetail,
    isLoadingNotes,
    isSaving,
    isSavingCategory,
    isSavingEdit,
    isUpdatingCategory,
    listError,
    newNote: handleNewNote,
    newNoteForCategory: handleNewNoteForCategory,
    notes,
    onDraftTextChange: handleDraftTextChange,
    openSourceNote,
    readMode,
    regenerateSelectedNoteDetails: handleRegenerateSelectedNoteDetails,
    renameCategory: renameNotebookCategory,
    saveError,
    saveNote: saveNotebookNote,
    saveSelectedNoteEdit: handleSaveSelectedNoteEdit,
    selectNote,
    selectedCategoryFilter,
    selectedNote,
    selectedNoteId,
    setCategoryDraft,
    setCategoryEditDraft,
    setIsSelectedNoteEditDirty,
    setSidebarTab,
    sidebarTab,
    sortedCategories,
    startCategoryRename,
    startNoteDrag: handleNoteDragStart,
    toggleCategoryManager,
    toggleReadMode,
    workspaceMode,
  } = notebook;
  const isSearchTab = sidebarTab === "search";
  const isSearchActive = activeSearchQuery !== null;
  const handleAskSourceSelect = useCallback(
    (noteId: number) => {
      if (!canOpenSourceNote()) return;
      clearSearch();
      openSourceNote(noteId);
    },
    [canOpenSourceNote, clearSearch, openSourceNote],
  );

  const ask = useAskController({
    availableNoteCount: notes.length,
    availableNoteIds,
    onSourceSelect: handleAskSourceSelect,
  });

  const handleAppModeChange = useCallback(
    (nextMode: Parameters<typeof handleModeChange>[0]) => {
      if (nextMode === "search" && sidebarTab !== "search") resumeLiveSearch();
      handleModeChange(nextMode);
    },
    [handleModeChange, resumeLiveSearch, sidebarTab],
  );

  useKeyboardShortcuts(handleAppModeChange, { captureRef, searchRef, askRef: ask.askRef });

  const handleSidebarTabChange = useCallback(
    (nextTab: SidebarTab) => {
      if (nextTab === sidebarTab) return;
      if (nextTab === "search") resumeLiveSearch();
      else pauseLiveSearch();
      setSidebarTab(nextTab);
    },
    [pauseLiveSearch, resumeLiveSearch, setSidebarTab, sidebarTab],
  );

  const handleCategoryFilterChange = useCallback(
    (filter: CategoryFilter) => {
      if (changeNotebookCategoryFilter(filter)) clearSearch();
    },
    [changeNotebookCategoryFilter, clearSearch],
  );
  const handleFolderClick = useCallback(
    (folder: (typeof browseFolders)[number]) => {
      if (clickNotebookFolder(folder)) clearSearch();
    },
    [clearSearch, clickNotebookFolder],
  );

  useEffect(() => {
    if (!isSearchTab) {
      return;
    }

    searchRef.current?.focus();
  }, [isSearchTab]);

  function handleSaveNote() {
    void saveNotebookNote().then((saved) => {
      if (saved) clearSearch();
    });
  }

  const toolbarControls = (
    <>
      <button
        aria-label={readMode ? "Edit Mode" : "Read Mode"}
        className={TOOLBAR_BUTTON_CLASS}
        onClick={toggleReadMode}
        title={readMode ? "Edit Mode" : "Read Mode"}
        type="button"
      >
        {readMode ? (
          <Pencil aria-hidden="true" size={15} strokeWidth={2} />
        ) : (
          <BookOpen aria-hidden="true" size={15} strokeWidth={2} />
        )}
      </button>
      {isTextAreaPaneFocused ? (
        <button
          aria-label={isFocusEditorShrunk ? "Expand editor" : "Shrink editor"}
          className={TOOLBAR_BUTTON_CLASS}
          onClick={() => setIsFocusEditorShrunk((currentValue) => !currentValue)}
          title={isFocusEditorShrunk ? "Expand editor" : "Shrink editor"}
          type="button"
        >
          {isFocusEditorShrunk ? (
            <Maximize2 aria-hidden="true" size={15} strokeWidth={2} />
          ) : (
            <Minimize2 aria-hidden="true" size={15} strokeWidth={2} />
          )}
        </button>
      ) : null}
      <button
        aria-label={isTextAreaPaneFocused ? "Exit" : "Focus Mode"}
        className={TOOLBAR_BUTTON_CLASS}
        onClick={toggleTextAreaFocus}
        title={isTextAreaPaneFocused ? "Exit" : "Focus Mode"}
        type="button"
      >
        <Maximize aria-hidden="true" size={15} strokeWidth={2} />
      </button>
    </>
  );

  return (
    <div className="workspace-root relative flex h-screen text-text-primary" ref={workspaceRootRef}>
      <NotesSidebar
        activeSearchQuery={activeSearchQuery}
        browseTreeProps={{
          browseFolders,
          dropTargetKey,
          expandedFolderKeys,
          getFolderDropTarget,
          isNoteSelected: ask.isNoteSelected,
          isNewNoteDisabled: isSaving || isSavingEdit || isDeleting,
          notes,
          onCategoryFilterChange: handleCategoryFilterChange,
          onFolderClick: handleFolderClick,
          onFolderDragLeave: handleFolderDragLeave,
          onFolderDragOver: handleFolderDragOver,
          onFolderDrop: (event, target) => void handleFolderDrop(event, target),
          onNoteDragEnd: clearNoteDrag,
          onNoteDragStart: handleNoteDragStart,
          onNewNoteForCategory: handleNewNoteForCategory,
          onNoteSelect: selectNote,
          onSetSourceNotesSelected: ask.setSourceNotesSelected,
          onToggleAllNotes: ask.toggleAllNotes,
          onToggleNoteScope: ask.toggleNoteScope,
          selectedCategoryFilter,
          selectedNoteId,
          useAllNotes: ask.noteScope.mode === "all",
        }}
        captureShortcutLabel={APP_SHORTCUTS.capture.label}
        categoryManagerProps={{
          categories: sortedCategories,
          categoryDraft,
          categoryEditDraft,
          categoryError,
          deletingCategoryId,
          editingCategoryId,
          isOpen: isCategoryManagerOpen,
          isSavingCategory,
          isUpdatingCategory,
          notes,
          onCancelRename: cancelCategoryRename,
          onCategoryDraftChange: setCategoryDraft,
          onCategoryEditDraftChange: setCategoryEditDraft,
          onCreate: () => void createNotebookCategory(),
          onDelete: (category, noteCount) => void handleDeleteCategory(category, noteCount),
          onRename: (categoryId) => void renameNotebookCategory(categoryId),
          onStartRename: startCategoryRename,
          onToggle: toggleCategoryManager,
          scopeSummary: ask.scopeSummary,
        }}
        className={leftPaneClassName}
        isDeleting={isDeleting}
        isLoadingNotes={isLoadingNotes}
        isSaving={isSaving}
        isSavingEdit={isSavingEdit}
        listError={listError}
        notes={notes}
        onClearSearch={clearSearch}
        onNewNote={handleNewNote}
        onSearchChange={handleSearchTextChange}
        onSearchSubmit={() => void handleSearchSubmit()}
        onSidebarTabChange={handleSidebarTabChange}
        searchError={searchError}
        searchRef={searchRef}
        searchResultsProps={{
          error: searchError,
          isActive: isSearchActive,
          isNoteSelected: ask.isNoteSelected,
          isSearching,
          onNoteSelect: selectNote,
          onToggleNoteScope: ask.toggleNoteScope,
          results: searchResults,
          selectedNoteId,
        }}
        searchText={searchText}
        sidebarRef={leftSidebarRef}
        sidebarTab={sidebarTab}
        style={{ width: leftPaneWidth }}
      />

      <PaneResizeHandle
        left={gripPositions.left}
        label="Resize notes sidebar"
        maxWidth={LEFT_PANE_MAX_WIDTH}
        onResizeStart={(event) => startPaneResize("left", event)}
        snapped={activeResizeSide === "left" && snappedResizeSide === "left"}
        width={leftPaneWidth}
      />

      <main className="workspace-center flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className="workspace-center-content flex min-h-0 flex-1 flex-col overflow-hidden"
          ref={workspaceCenterContentRef}
          style={{
            maxWidth: "100%",
            width:
              isTextAreaPaneFocused && isFocusEditorShrunk && preFocusCenterWidth !== null
                ? preFocusCenterWidth
                : "100%",
          }}
        >
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
            onDraftTextChange={handleDraftTextChange}
            onEdit={handleEditSelectedNote}
            onEditDirtyChange={setIsSelectedNoteEditDirty}
            onNewNote={handleNewNote}
            onRegenerateDetails={handleRegenerateSelectedNoteDetails}
            onSave={handleSaveNote}
            onSaveEdit={handleSaveSelectedNoteEdit}
            readMode={readMode}
            saveError={saveError}
            surfaceRef={markdownSurfaceRef}
            toolbarControls={toolbarControls}
          />
        </div>
      </main>

      <PaneResizeHandle
        className="hidden lg:flex"
        left={gripPositions.right}
        label="Resize Bun"
        maxWidth={RIGHT_PANE_MAX_WIDTH}
        onResizeStart={(event) => startPaneResize("right", event)}
        snapped={activeResizeSide === "right" && snappedResizeSide === "right"}
        width={rightPaneWidth}
      />

      <aside
        aria-label="Bun pane"
        className={rightPaneClassName}
        ref={rightSidebarRef}
        style={{ width: rightPaneWidth }}
      >
        <AskChat
          askRef={ask.askRef}
          activeThreadId={ask.activeThreadId}
          hasNotes={notes.length > 0}
          messages={ask.messages}
          threads={ask.threads}
          onSourceSelect={ask.onSourceSelect}
          onDeleteThread={(threadId) => void ask.onDeleteThread(threadId)}
          onNewThread={() => void ask.onNewThread()}
          onRenameThread={(threadId, newTitle) => void ask.onRenameThread(threadId, newTitle)}
          onThreadChange={(threadId) => void ask.onThreadChange(threadId)}
          onSubmit={(question) => void ask.onSubmit(question)}
          pendingMessageId={ask.pendingMessageId}
          isSubmitDisabled={ask.isSubmitDisabled}
          scopeLabel={ask.scopeLabel}
          submitDisabledMessage={ask.submitDisabledMessage}
        />
      </aside>
    </div>
  );
}
