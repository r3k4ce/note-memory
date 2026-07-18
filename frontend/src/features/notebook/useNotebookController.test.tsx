import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { DragEvent } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createCategory,
  createNote,
  deleteCategory,
  deleteNote,
  getNote,
  listCategories,
  listNotes,
  organizeNote,
  updateCategory,
  updateNote,
} from "../../api";
import type { Category, Note } from "../../types";
import { useNotebookController } from "./useNotebookController";

vi.mock("../../api", () => ({
  createCategory: vi.fn(),
  createNote: vi.fn(),
  deleteCategory: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn(),
  listCategories: vi.fn(),
  listNotes: vi.fn(),
  organizeNote: vi.fn(),
  updateCategory: vi.fn(),
  updateNote: vi.fn(),
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
const workNote: Note = {
  id: 10,
  original_text: "Work note body",
  ai_title: "Work note",
  short_summary: "A note about work.",
  tags: ["work"],
  date_added: "2026-07-03T00:00:00Z",
  updated_at: "2026-07-03T00:00:00Z",
  category: workCategory,
  needs_ai_organization: false,
};
const personalNote: Note = {
  ...workNote,
  id: 11,
  original_text: "Personal note body",
  ai_title: "Personal note",
  category: personalCategory,
};

function renderController() {
  const reconciliation = {
    deleteNotes: vi.fn(),
    renameCategory: vi.fn(),
    replaceNote: vi.fn(),
    uncategorizeNotes: vi.fn(),
  };
  const hook = renderHook(() => useNotebookController(reconciliation));
  return { ...hook, reconciliation };
}

function dragEvent(): DragEvent<HTMLButtonElement> {
  return {
    dataTransfer: {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
    },
    preventDefault: vi.fn(),
  } as unknown as DragEvent<HTMLButtonElement>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("useNotebookController", () => {
  test("loads notes and sorted category folders", async () => {
    vi.mocked(listNotes).mockResolvedValueOnce([workNote, personalNote]);
    vi.mocked(listCategories).mockResolvedValueOnce([workCategory, personalCategory]);
    const { result } = renderController();

    await waitFor(() => expect(result.current.isLoadingNotes).toBe(false));

    expect(result.current.notes).toEqual([workNote, personalNote]);
    expect(result.current.sortedCategories.map((category) => category.name)).toEqual([
      "Personal",
      "Work",
    ]);
    expect(result.current.browseFolders.map((folder) => folder.label)).toEqual([
      "Uncategorized",
      "Personal",
      "Work",
    ]);
  });

  test("protects dirty edits during source navigation and drag start", async () => {
    vi.mocked(listNotes).mockResolvedValueOnce([workNote, personalNote]);
    vi.mocked(listCategories).mockResolvedValueOnce([workCategory, personalCategory]);
    vi.mocked(getNote).mockResolvedValue(personalNote);
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const { result } = renderController();
    await waitFor(() => expect(result.current.isLoadingNotes).toBe(false));

    act(() => result.current.selectNote(workNote.id));
    act(() => result.current.setIsSelectedNoteEditDirty(true));
    let canOpen = true;
    act(() => {
      canOpen = result.current.canOpenSourceNote();
    });
    expect(canOpen).toBe(false);
    expect(result.current.selectedNoteId).toBe(workNote.id);

    const event = dragEvent();
    act(() => result.current.startNoteDrag(event, workNote.id));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.draggedNoteId).toBeNull();
    expect(updateNote).not.toHaveBeenCalled();

    act(() => {
      canOpen = result.current.canOpenSourceNote();
    });
    expect(canOpen).toBe(true);
    act(() => result.current.openSourceNote(personalNote.id));
    expect(confirm).toHaveBeenCalledWith("Discard unsaved note changes?");
    expect(result.current.selectedNoteId).toBe(personalNote.id);
    expect(result.current.selectedCategoryFilter).toBe(personalCategory.id);
    expect(result.current.draftCategoryId).toBe(personalCategory.id);
  });

  test("creates, renames, and deletes categories with result reconciliation", async () => {
    vi.mocked(listNotes).mockResolvedValueOnce([workNote]);
    vi.mocked(listCategories).mockResolvedValueOnce([workCategory]);
    const researchCategory = { ...personalCategory, name: "Research", slug: "research" };
    const projectsCategory = { ...workCategory, name: "Projects", slug: "projects" };
    vi.mocked(createCategory).mockResolvedValueOnce(researchCategory);
    vi.mocked(updateCategory).mockResolvedValueOnce(projectsCategory);
    vi.mocked(deleteCategory).mockResolvedValueOnce({
      id: workCategory.id,
      deleted: true,
      deleted_note_ids: [],
      uncategorized_note_ids: [workNote.id],
      vector_cleanup: "deleted",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, reconciliation } = renderController();
    await waitFor(() => expect(result.current.isLoadingNotes).toBe(false));

    act(() => result.current.setCategoryDraft("Research"));
    await act(() => result.current.createCategory());
    expect(createCategory).toHaveBeenCalledWith("Research");
    expect(result.current.categories).toContainEqual(researchCategory);

    act(() => result.current.startCategoryRename(workCategory));
    act(() => result.current.setCategoryEditDraft("Projects"));
    await act(() => result.current.renameCategory(workCategory.id));
    expect(reconciliation.renameCategory).toHaveBeenCalledWith(projectsCategory);

    await act(() => result.current.deleteCategory(projectsCategory, 1));
    expect(window.confirm).toHaveBeenCalledWith(
      'Delete "Projects" and uncategorize its 1 note?',
    );
    expect(reconciliation.deleteNotes).toHaveBeenCalledWith([]);
    expect(reconciliation.uncategorizeNotes).toHaveBeenCalledWith([workNote.id]);
    expect(result.current.notes[0].category).toBeNull();
  });

  test("creates notes at the front and reports success for cross-feature search clearing", async () => {
    vi.mocked(listNotes).mockResolvedValueOnce([workNote]);
    vi.mocked(listCategories).mockResolvedValueOnce([workCategory]);
    const savedNote = { ...personalNote, id: 12 };
    vi.mocked(createNote).mockResolvedValueOnce(savedNote);
    const { result } = renderController();
    await waitFor(() => expect(result.current.isLoadingNotes).toBe(false));

    act(() =>
      result.current.onDraftTextChange(
        ["---", "title: Saved note", "---", "", "Saved body"].join("\n"),
      ),
    );
    let saved = false;
    await act(async () => {
      saved = await result.current.saveNote();
    });

    expect(saved).toBe(true);
    expect(result.current.notes.map((note) => note.id)).toEqual([12, 10]);
    expect(result.current.selectedNoteId).toBe(12);
    expect(result.current.workspaceMode).toBe("edit-selected");
  });

  test("starts a blank category-assigned note after confirming a dirty selected edit", async () => {
    vi.mocked(listNotes).mockResolvedValueOnce([workNote]);
    vi.mocked(listCategories).mockResolvedValueOnce([workCategory]);
    vi.mocked(getNote).mockResolvedValueOnce(workNote);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result } = renderController();
    await waitFor(() => expect(result.current.isLoadingNotes).toBe(false));
    act(() => result.current.selectNote(workNote.id));
    await waitFor(() => expect(result.current.selectedNote).toEqual(workNote));
    act(() => result.current.setIsSelectedNoteEditDirty(true));
    act(() => result.current.onDraftTextChange("Unsaved new-note draft"));

    let created = false;
    act(() => {
      created = result.current.newNoteForCategory(workCategory.id);
    });

    expect(created).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Discard unsaved note changes?");
    expect(result.current.workspaceMode).toBe("new");
    expect(result.current.selectedNoteId).toBeNull();
    expect(result.current.selectedNote).toBeNull();
    expect(result.current.selectedCategoryFilter).toBe(workCategory.id);
    expect(result.current.draftCategoryId).toBe(workCategory.id);
    expect(result.current.draftText).toBe(
      "---\ntitle: \nsummary: \ntags: \ncategory: Work\n---\n",
    );
  });

  test("keeps the dirty selected note open when category quick-create is declined", async () => {
    vi.mocked(listNotes).mockResolvedValueOnce([workNote]);
    vi.mocked(listCategories).mockResolvedValueOnce([workCategory]);
    vi.mocked(getNote).mockResolvedValueOnce(workNote);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderController();
    await waitFor(() => expect(result.current.isLoadingNotes).toBe(false));
    act(() => result.current.selectNote(workNote.id));
    await waitFor(() => expect(result.current.selectedNote).toEqual(workNote));
    act(() => result.current.setIsSelectedNoteEditDirty(true));

    let created = true;
    act(() => {
      created = result.current.newNoteForCategory(workCategory.id);
    });

    expect(created).toBe(false);
    expect(result.current.workspaceMode).toBe("edit-selected");
    expect(result.current.selectedNoteId).toBe(workNote.id);
  });

  test("updates and deletes selected notes with exact confirmation and reconciliation", async () => {
    vi.mocked(listNotes).mockResolvedValueOnce([workNote]);
    vi.mocked(listCategories).mockResolvedValueOnce([workCategory]);
    vi.mocked(getNote).mockResolvedValueOnce(workNote);
    const savedNote = { ...workNote, ai_title: "Updated note" };
    vi.mocked(updateNote).mockResolvedValueOnce(savedNote);
    vi.mocked(deleteNote).mockResolvedValueOnce(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { result, reconciliation } = renderController();
    await waitFor(() => expect(result.current.isLoadingNotes).toBe(false));
    act(() => result.current.selectNote(workNote.id));
    await waitFor(() => expect(result.current.selectedNote).toEqual(workNote));

    await act(() =>
      result.current.saveSelectedNoteEdit({
        original_text: "Updated body",
        ai_title: "Updated note",
        short_summary: "Updated summary",
        tags: ["updated"],
        category_id: null,
      }),
    );
    expect(reconciliation.replaceNote).toHaveBeenCalledWith(savedNote);

    await act(() => result.current.deleteNote(workNote.id));
    expect(window.confirm).toHaveBeenCalledWith(
      'Delete "Updated note"? This cannot be undone.',
    );
    expect(reconciliation.deleteNotes).toHaveBeenCalledWith([workNote.id]);
    expect(result.current.workspaceMode).toBe("new");
  });

  test("moves notes between category folders and preserves drag lifecycle state", async () => {
    vi.mocked(listNotes).mockResolvedValueOnce([workNote, personalNote]);
    vi.mocked(listCategories).mockResolvedValueOnce([workCategory, personalCategory]);
    const movedNote = { ...workNote, category: personalCategory };
    vi.mocked(updateNote).mockResolvedValueOnce(movedNote);
    const { result, reconciliation } = renderController();
    await waitFor(() => expect(result.current.isLoadingNotes).toBe(false));
    const event = dragEvent();
    const target = { categoryId: personalCategory.id, key: "category:2" };

    act(() => result.current.startNoteDrag(event, workNote.id));
    act(() => result.current.dragOverFolder(event, target));
    expect(result.current.dropTargetKey).toBe(target.key);
    await act(() => result.current.dropNoteOnFolder(event, target));

    expect(updateNote).toHaveBeenCalledWith(workNote.id, { category_id: personalCategory.id });
    expect(reconciliation.replaceNote).toHaveBeenCalledWith(movedNote);
    expect(result.current.expandedFolderKeys.has(target.key)).toBe(true);
    expect(result.current.draggedNoteId).toBeNull();
    expect(result.current.dropTargetKey).toBeNull();
  });

  test("delegates note organization while keeping its HTTP call inside the controller", async () => {
    vi.mocked(listNotes).mockResolvedValueOnce([]);
    vi.mocked(listCategories).mockResolvedValueOnce([]);
    const organized = { ai_title: "Organized", short_summary: "Summary", tags: ["tag"] };
    vi.mocked(organizeNote).mockResolvedValueOnce(organized);
    const { result } = renderController();
    await waitFor(() => expect(result.current.isLoadingNotes).toBe(false));

    await expect(result.current.regenerateSelectedNoteDetails("Body")).resolves.toEqual(organized);
    expect(organizeNote).toHaveBeenCalledWith("Body");
  });
});
