import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { BrowseTree, type BrowseTreeProps } from "./BrowseTree";
import type { Category, Note } from "../../types";

afterEach(cleanup);

const category: Category = {
  id: 1,
  name: "Work",
  slug: "work",
  created_at: "2026-07-01",
  updated_at: "2026-07-01",
};
const notes: Note[] = [
  {
    id: 10,
    original_text: "Body",
    ai_title: "First work note",
    short_summary: "Summary",
    tags: [],
    date_added: "2026-07-03T00:00:00Z",
    updated_at: "2026-07-03T00:00:00Z",
    category,
    needs_ai_organization: false,
  },
  {
    id: 11,
    original_text: "Body",
    ai_title: "Second work note",
    short_summary: "Summary",
    tags: [],
    date_added: "2026-07-04T00:00:00Z",
    updated_at: "2026-07-04T00:00:00Z",
    category,
    needs_ai_organization: false,
  },
];
const folder = { filter: category.id, key: "category:1", label: "Work", notes } as const;
const uncategorizedFolder = {
  filter: "uncategorized" as const,
  key: "uncategorized",
  label: "Uncategorized",
  notes: [],
};

function createProps(overrides: Partial<BrowseTreeProps> = {}): BrowseTreeProps {
  return {
    browseFolders: [folder],
    dropTargetKey: null,
    expandedFolderKeys: new Set(),
    getFolderDropTarget: (browseFolder) => ({
      categoryId: browseFolder.filter === "uncategorized" ? null : browseFolder.filter,
      key: browseFolder.key,
    }),
    isNoteSelected: () => true,
    isNewNoteDisabled: false,
    notes,
    onCategoryFilterChange: vi.fn(),
    onNewNoteForCategory: vi.fn(),
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
    ...overrides,
  };
}

describe("BrowseTree", () => {
  test("renders one collapsed browse hierarchy with Ask checkboxes", () => {
    render(<BrowseTree {...createProps()} />);
    const tree = screen.getByRole("tree", { name: "Browse notes" });

    expect(within(tree).getByRole("button", { name: "All notes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(tree).getByRole("checkbox", { name: "Use all notes for Ask" })).toBeChecked();
    expect(within(tree).getByRole("button", { name: "Work" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(tree).queryByRole("button", { name: /First work note/ })).not.toBeInTheDocument();
  });

  test("preserves partially-selected category indeterminate behavior and bulk selection", () => {
    const onSetSourceNotesSelected = vi.fn();
    render(
      <BrowseTree
        {...createProps({
          isNoteSelected: (noteId) => noteId === 10,
          onSetSourceNotesSelected,
        })}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Use Work category for Ask" });
    expect(checkbox).not.toBeChecked();
    expect((checkbox as HTMLInputElement).indeterminate).toBe(true);

    fireEvent.click(checkbox);
    expect(onSetSourceNotesSelected).toHaveBeenCalledWith([10, 11], true);
  });

  test("integrates quick-create before the named category count without nesting it in the folder button", () => {
    const onFolderClick = vi.fn();
    const onNewNoteForCategory = vi.fn();
    render(
      <BrowseTree
        {...createProps({
          browseFolders: [uncategorizedFolder, folder],
          onFolderClick,
          onNewNoteForCategory,
        })}
      />,
    );

    const folderButton = screen.getByRole("button", { name: "Work" });
    const quickCreateButton = screen.getByRole("button", { name: "New note in Work category" });
    expect(quickCreateButton).toBeEnabled();
    expect(folderButton).not.toContainElement(quickCreateButton);
    expect(folderButton.parentElement).toHaveClass("relative", "group");
    expect(folderButton).toHaveClass("peer");
    expect(quickCreateButton).toHaveClass(
      "absolute",
      "right-7",
      "group-hover:opacity-100",
      "peer-focus:opacity-100",
      "focus:opacity-100",
      "group-hover:bg-surface-hover",
    );
    expect(
      screen.queryByRole("button", { name: "New note in Uncategorized category" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /New note in All notes/ })).not.toBeInTheDocument();

    fireEvent.click(quickCreateButton);

    expect(onNewNoteForCategory).toHaveBeenCalledWith(category.id);
    expect(onFolderClick).not.toHaveBeenCalled();

    fireEvent.click(folderButton);
    expect(onFolderClick).toHaveBeenCalledWith(folder);

    fireEvent.click(within(folderButton).getByText(String(notes.length)));
    expect(onFolderClick).toHaveBeenCalledTimes(2);
  });

  test("disables quick-create while note actions are unavailable", () => {
    render(<BrowseTree {...createProps({ isNewNoteDisabled: true })} />);

    expect(screen.getByRole("button", { name: "New note in Work category" })).toHaveClass(
      "disabled:!opacity-40",
    );
    expect(screen.getByRole("button", { name: "New note in Work category" })).toBeDisabled();
  });

  test("forwards folder and note click and drag events without owning state", () => {
    const onFolderClick = vi.fn();
    const onFolderDragLeave = vi.fn();
    const onFolderDragOver = vi.fn();
    const onFolderDrop = vi.fn();
    const onNoteDragEnd = vi.fn();
    const onNoteDragStart = vi.fn();
    const onNoteSelect = vi.fn();
    render(
      <BrowseTree
        {...createProps({
          expandedFolderKeys: new Set([folder.key]),
          onFolderClick,
          onFolderDragLeave,
          onFolderDragOver,
          onFolderDrop,
          onNoteDragEnd,
          onNoteDragStart,
          onNoteSelect,
        })}
      />,
    );
    const folderButton = screen.getByRole("button", { name: "Work" });
    fireEvent.click(folderButton);
    fireEvent.dragOver(folderButton);
    fireEvent.dragLeave(folderButton);
    fireEvent.drop(folderButton);

    const noteButton = screen.getByRole("button", { name: /First work note/ });
    fireEvent.click(noteButton);
    fireEvent.dragStart(noteButton);
    fireEvent.dragEnd(noteButton);

    const target = { categoryId: 1, key: "category:1" };
    expect(onFolderClick).toHaveBeenCalledWith(folder);
    expect(onFolderDragOver).toHaveBeenCalledWith(expect.any(Object), target);
    expect(onFolderDragLeave).toHaveBeenCalledWith(target);
    expect(onFolderDrop).toHaveBeenCalledWith(expect.any(Object), target);
    expect(onNoteSelect).toHaveBeenCalledWith(10);
    expect(onNoteDragStart).toHaveBeenCalledWith(expect.any(Object), 10);
    expect(onNoteDragEnd).toHaveBeenCalledOnce();
  });
});
