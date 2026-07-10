import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { NotesSidebar, type NotesSidebarProps } from "./NotesSidebar";

afterEach(cleanup);

function createProps(overrides: Partial<NotesSidebarProps> = {}): NotesSidebarProps {
  return {
    activeSearchQuery: null,
    browseTreeProps: {
      browseFolders: [],
      dropTargetKey: null,
      expandedFolderKeys: new Set(),
      getFolderDropTarget: (folder) => ({
        categoryId: folder.filter === "uncategorized" ? null : folder.filter,
        key: folder.key,
      }),
      isNoteSelected: () => true,
      notes: [],
      onCategoryFilterChange: vi.fn(),
      onFolderClick: vi.fn(),
      onFolderDragLeave: vi.fn(),
      onFolderDragOver: vi.fn(),
      onFolderDrop: vi.fn(),
      onNoteDragEnd: vi.fn(),
      onNoteDragStart: vi.fn(),
      onNoteSelect: vi.fn(),
      onSetSourceNotesSelected: vi.fn(),
      onToggleAllNotes: vi.fn(),
      onToggleNoteScope: vi.fn(),
      selectedCategoryFilter: "all",
      selectedNoteId: null,
      useAllNotes: true,
    },
    captureShortcutLabel: "Alt+1",
    categoryManagerProps: {
      categories: [],
      categoryDraft: "",
      categoryEditDraft: "",
      categoryError: null,
      deletingCategoryId: null,
      editingCategoryId: null,
      isOpen: false,
      isSavingCategory: false,
      isUpdatingCategory: false,
      notes: [],
      onCancelRename: vi.fn(),
      onCategoryDraftChange: vi.fn(),
      onCategoryEditDraftChange: vi.fn(),
      onCreate: vi.fn(),
      onDelete: vi.fn(),
      onRename: vi.fn(),
      onStartRename: vi.fn(),
      onToggle: vi.fn(),
      scopeSummary: "All notes selected",
    },
    className: "workspace-side-pane",
    isDeleting: false,
    isLoadingNotes: false,
    isSaving: false,
    isSavingEdit: false,
    listError: null,
    notes: [],
    onClearSearch: vi.fn(),
    onNewNote: vi.fn(),
    onSearchChange: vi.fn(),
    onSearchSubmit: vi.fn(),
    onSidebarTabChange: vi.fn(),
    searchError: null,
    searchRef: createRef<HTMLInputElement>(),
    searchResultsProps: {
      error: null,
      isActive: false,
      isNoteSelected: () => true,
      isSearching: false,
      onNoteSelect: vi.fn(),
      onToggleNoteScope: vi.fn(),
      results: [],
      selectedNoteId: null,
    },
    searchText: "",
    sidebarRef: createRef<HTMLElement>(),
    sidebarTab: "browse",
    style: { width: 320 },
    ...overrides,
  };
}

describe("NotesSidebar", () => {
  test("renders the branded sidebar shell and forwards primary actions", () => {
    const onNewNote = vi.fn();
    const onSidebarTabChange = vi.fn();
    render(<NotesSidebar {...createProps({ onNewNote, onSidebarTabChange })} />);

    const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
    expect(sidebar).toHaveClass("workspace-side-pane");
    expect(sidebar).toHaveStyle({ width: "320px" });
    expect(within(sidebar).getByLabelText("Notebun Bun mark")).toHaveClass("bun-mark");
    expect(within(sidebar).getByText("Notebun")).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "Browse themes" })).toBeInTheDocument();

    fireEvent.click(within(sidebar).getByRole("button", { name: "New note" }));
    fireEvent.click(within(sidebar).getByRole("tab", { name: "Search" }));
    expect(onNewNote).toHaveBeenCalledOnce();
    expect(onSidebarTabChange).toHaveBeenCalledWith("search");
  });

  test("renders search input and active-query status without backend workflows", () => {
    render(
      <NotesSidebar
        {...createProps({
          activeSearchQuery: "work",
          searchResultsProps: {
            error: null,
            isActive: true,
            isNoteSelected: () => true,
            isSearching: false,
            onNoteSelect: vi.fn(),
            onToggleNoteScope: vi.fn(),
            results: [],
            selectedNoteId: null,
          },
          searchText: "work",
          sidebarTab: "search",
        })}
      />,
    );

    expect(screen.getByRole("searchbox", { name: "Search notes" })).toHaveValue("work");
    expect(screen.getByText("Results for “work”")).toBeInTheDocument();
    expect(screen.getByText("No matching notes", { selector: "p" })).toBeInTheDocument();
    expect(screen.queryByRole("tree", { name: "Browse notes" })).not.toBeInTheDocument();
  });

  test("preserves the browse loading, error, and first-note empty states", () => {
    const { rerender } = render(<NotesSidebar {...createProps({ isLoadingNotes: true })} />);
    expect(screen.getByText("Opening your notebook…")).toBeInTheDocument();

    rerender(<NotesSidebar {...createProps({ listError: "Notebook unavailable" })} />);
    expect(screen.getByText("Notebook unavailable")).toHaveClass("text-error");

    rerender(<NotesSidebar {...createProps()} />);
    expect(screen.getByText("Start your notebook")).toBeInTheDocument();
    expect(screen.getByText("Alt+1")).toBeInTheDocument();
  });
});
