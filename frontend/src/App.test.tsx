import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { askQuestion, createCategory, deleteCategory, searchNotes, updateCategory } from "./api";
import App from "./App";
import type { Category, Note, SearchResult } from "./types";

const { categories, notes } = vi.hoisted(() => {
  const mockCategories: Category[] = [
    { id: 1, name: "Work", slug: "work", created_at: "2026-07-01", updated_at: "2026-07-01" },
    {
      id: 2,
      name: "Personal",
      slug: "personal",
      created_at: "2026-07-02",
      updated_at: "2026-07-02",
    },
  ];

  const mockNotes: Note[] = [
    {
      id: 10,
      original_text: "Work note body",
      ai_title: "Work note",
      short_summary: "A note about work.",
      tags: ["work"],
      date_added: "2026-07-03T00:00:00Z",
      updated_at: "2026-07-03T00:00:00Z",
      category: mockCategories[0],
    },
    {
      id: 11,
      original_text: "Personal note body",
      ai_title: "Personal note",
      short_summary: "A note about personal plans.",
      tags: ["personal"],
      date_added: "2026-07-04T00:00:00Z",
      updated_at: "2026-07-04T00:00:00Z",
      category: mockCategories[1],
    },
  ];

  return { categories: mockCategories, notes: mockNotes };
});

vi.mock("./api", () => ({
  askQuestion: vi.fn(),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn().mockResolvedValue(notes[0]),
  listCategories: vi.fn().mockResolvedValue(categories),
  listNotes: vi.fn().mockResolvedValue(notes),
  searchNotes: vi.fn().mockResolvedValue([]),
  updateCategory: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("./components/AskChat", () => ({
  AskChat({
    isSubmitDisabled,
    onSubmit,
    scopeLabel,
    submitDisabledMessage,
  }: {
    isSubmitDisabled?: boolean;
    onSubmit: (question: string) => void;
    scopeLabel: string;
    submitDisabledMessage?: string;
  }) {
    return (
      <section aria-label="Ask chat">
        <span>Mock Ask scope: {scopeLabel}</span>
        {submitDisabledMessage ? <span>{submitDisabledMessage}</span> : null}
        <button disabled={isSubmitDisabled} onClick={() => onSubmit("What did I save?")} type="button">
          Mock ask
        </button>
      </section>
    );
  },
}));

vi.mock("./components/NoteWorkspace", () => ({
  NoteWorkspace({
    mode,
    note,
    onEditDirtyChange,
    onEdit,
  }: {
    mode: string;
    note: Note | null;
    onEditDirtyChange: (isDirty: boolean) => void;
    onEdit: () => void;
  }) {
    return (
      <section aria-label="Note workspace" data-mode={mode}>
        <span>Workspace mode: {mode}</span>
        {note ? <span>Loaded note: {note.ai_title}</span> : null}
        <button onClick={onEdit} type="button">
          Mock edit
        </button>
        <button onClick={() => onEditDirtyChange(true)} type="button">
          Mock dirty
        </button>
      </section>
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function getSidebarNewNoteButton() {
  return within(screen.getByRole("complementary", { name: "Notes sidebar" })).getByRole("button", {
    name: "New note",
  });
}

function getBrowseTree() {
  return within(screen.getByRole("complementary", { name: "Notes sidebar" })).getByRole("tree", {
    name: "Browse notes",
  });
}

function openSearchTab() {
  fireEvent.click(screen.getByRole("tab", { name: "Search" }));
}

async function expandCategory(name: string) {
  await waitFor(() => {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  });

  const categoryButton = screen.getByRole("button", { name });
  if (categoryButton.getAttribute("aria-expanded") === "false") {
    fireEvent.click(categoryButton);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, reject, resolve };
}

describe("App sidebar navigation", () => {
  test("separates browse and search into sidebar tabs", async () => {
    render(<App />);

    const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });

    await waitFor(() => {
      expect(within(sidebar).getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    expect(within(sidebar).getByRole("tab", { name: "Browse" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(sidebar).getByRole("tab", { name: "Search" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(within(sidebar).queryByRole("searchbox", { name: "Search notes" })).not.toBeInTheDocument();
    expect(within(sidebar).queryByText("Browse", { selector: "span" })).not.toBeInTheDocument();

    fireEvent.click(within(sidebar).getByRole("tab", { name: "Search" }));

    expect(within(sidebar).getByRole("tab", { name: "Search" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(sidebar).getByRole("searchbox", { name: "Search notes" })).toBeInTheDocument();
    expect(within(sidebar).queryByRole("tree", { name: "Browse notes" })).not.toBeInTheDocument();
    expect(within(sidebar).queryByText("Search results", { selector: "span" })).not.toBeInTheDocument();
  });

  test("keeps keyboard shortcuts unchanged while Alt+2 opens search", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Browse" })).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { altKey: true, key: "2" });

    expect(screen.getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("searchbox", { name: "Search notes" })).toHaveFocus();

    fireEvent.keyDown(window, { altKey: true, key: "1" });

    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();

    fireEvent.keyDown(window, { altKey: true, key: "3" });

    expect(screen.getByRole("button", { name: "Mock ask" })).toBeInTheDocument();
  });

  test("organizes browsing as one collapsed category tree with nested notes", async () => {
    render(<App />);

    const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
    const title = screen.getByText("Note Memory");
    const newNote = within(sidebar).getByRole("button", { name: "New note" });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const tree = getBrowseTree();
    const allNotes = within(tree).getByRole("button", { name: "All notes" });
    const uncategorized = within(tree).getByRole("button", { name: "Uncategorized" });
    const personalCategory = within(tree).getByRole("button", { name: "Personal" });
    const workCategory = within(tree).getByRole("button", { name: "Work" });
    const askAllNotes = within(tree).getByRole("checkbox", { name: "Use all notes for Ask" });

    expect(sidebar).toContainElement(title);
    expect(sidebar).toContainElement(newNote);
    expect(title.compareDocumentPosition(newNote)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByText("Ask sources")).not.toBeInTheDocument();
    expect(tree).toContainElement(askAllNotes);
    expect(allNotes.compareDocumentPosition(uncategorized)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(uncategorized.compareDocumentPosition(personalCategory)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(personalCategory).toHaveAttribute("aria-expanded", "false");
    expect(workCategory).toHaveAttribute("aria-expanded", "false");
    expect(within(tree).queryByRole("button", { name: /Personal note/ })).not.toBeInTheDocument();
    expect(within(tree).queryByRole("button", { name: /Work note/ })).not.toBeInTheDocument();
  });

  test("keeps category manager collapsed by default and creates categories from browse mode", async () => {
    vi.mocked(createCategory).mockResolvedValueOnce({
      id: 3,
      name: "Research",
      slug: "research",
      created_at: "2026-07-05",
      updated_at: "2026-07-05",
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Categories" })).toBeInTheDocument();
    });

    const categoriesButton = screen.getByRole("button", { name: "Categories" });
    expect(categoriesButton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Manage categories" })).not.toBeInTheDocument();

    fireEvent.click(categoriesButton);

    const manager = screen.getByRole("region", { name: "Manage categories" });
    expect(categoriesButton).toHaveAttribute("aria-expanded", "true");

    fireEvent.change(within(manager).getByRole("textbox", { name: "New category name" }), {
      target: { value: "Research" },
    });
    fireEvent.click(within(manager).getByRole("button", { name: "Add category" }));

    await waitFor(() => {
      expect(createCategory).toHaveBeenCalledWith("Research");
    });
    expect(screen.getByRole("button", { name: "Research" })).toBeInTheDocument();
  });

  test("renames categories from the collapsed browse manager", async () => {
    vi.mocked(updateCategory).mockResolvedValueOnce({
      ...categories[0],
      name: "Projects",
      slug: "projects",
      updated_at: "2026-07-05",
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Categories" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Categories" }));
    const manager = screen.getByRole("region", { name: "Manage categories" });
    fireEvent.click(within(manager).getByRole("button", { name: "Rename Work" }));
    fireEvent.change(within(manager).getByRole("textbox", { name: "Category name" }), {
      target: { value: "Projects" },
    });
    fireEvent.click(within(manager).getByRole("button", { name: "Save category" }));

    await waitFor(() => {
      expect(updateCategory).toHaveBeenCalledWith(1, "Projects");
    });
    expect(screen.getByRole("button", { name: "Projects" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Work" })).not.toBeInTheDocument();
  });

  test("deletes categories and their notes from browse mode after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.mocked(deleteCategory).mockResolvedValueOnce({
      id: 1,
      deleted: true,
      deleted_note_ids: [10],
      vector_cleanup: "deleted",
    });

    render(<App />);

    await expandCategory("Work");
    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));
    expect(screen.getByText("Workspace mode: read-selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Categories" }));
    const manager = screen.getByRole("region", { name: "Manage categories" });
    fireEvent.click(within(manager).getByRole("button", { name: "Delete Work" }));

    await waitFor(() => {
      expect(deleteCategory).toHaveBeenCalledWith(1);
    });
    expect(confirm).toHaveBeenCalledWith('Delete "Work" and its 1 note? This cannot be undone.');
    expect(screen.queryByRole("button", { name: "Work" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Work note/ })).not.toBeInTheDocument();
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();
  });

  test("keeps category navigation separate from global search behavior", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Uncategorized" }));

    expect(screen.queryByText(/Scope:/)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Browse" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Uncategorized", { selector: "span" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Uncategorized" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(screen.getAllByText("Work", { selector: "span" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Work" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "react" } });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => {
      expect(searchNotes).toHaveBeenCalledWith("react");
    });

    expect(screen.queryByText("Search results", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByText("Results for “react”", { selector: "span" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchbox).toHaveValue("");
    expect(screen.getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
  });

  test("expands collapsed categories to reveal nested notes without opening them", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    expect(screen.queryByRole("button", { name: /Work note/ })).not.toBeInTheDocument();
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    const workNote = screen.getByRole("button", { name: /Work note/ });

    expect(workNote).toBeInTheDocument();
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();
  });

  test("shows Ask source checkboxes without a selection mode", async () => {
    render(<App />);

    await expandCategory("Work");

    expect(screen.queryByRole("button", { name: "Select notes for Ask" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done selecting notes for Ask" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Use all notes for Ask" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Use Work category for Ask" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).toBeChecked();
  });

  test("uses visible Ask source selections for payloads without browse category scope", async () => {
    vi.mocked(askQuestion).mockResolvedValue({
      answer: "Saved notes mention work.",
      sources: [],
    });

    render(<App />);

    await expandCategory("Work");

    expect(screen.queryByText("Ask sources")).not.toBeInTheDocument();
    expect(screen.getByText("Mock Ask scope: All notes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock ask" }));

    await waitFor(() => {
      expect(askQuestion).toHaveBeenCalledWith(
        expect.not.objectContaining({
          category_id: expect.anything(),
          note_ids: expect.anything(),
          uncategorized: expect.anything(),
        }),
      );
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Use all notes for Ask" }));

    expect(screen.getByText("No sources selected")).toBeInTheDocument();
    expect(screen.getByText("Select at least one source for Ask.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock ask" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Use Work category for Ask" }));

    expect(screen.getByText("1 note selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock ask" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Mock ask" }));

    await waitFor(() => {
      expect(askQuestion).toHaveBeenLastCalledWith(expect.objectContaining({ note_ids: [10] }));
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Use all notes for Ask" }));

    expect(screen.getByText("All notes selected")).toBeInTheDocument();
  });

  test("opens the existing new-note workspace from the sidebar action", async () => {
    render(<App />);

    await expandCategory("Work");

    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));
    expect(screen.getByText("Workspace mode: read-selected")).toBeInTheDocument();

    fireEvent.click(getSidebarNewNoteButton());

    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();
  });

  test("shows compact note rows while browsing", async () => {
    render(<App />);

    await expandCategory("Work");

    const noteRow = screen.getByRole("button", { name: /Work note/ });

    expect(noteRow).toHaveTextContent("Work note");
    expect(noteRow).toHaveTextContent("07-03");
    expect(noteRow).not.toHaveTextContent("A note about work.");
    expect(noteRow).not.toHaveTextContent("work");
    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).toBeInTheDocument();

    fireEvent.click(noteRow);

    expect(screen.getByText("Workspace mode: read-selected")).toBeInTheDocument();
    expect(noteRow.className).toContain("border-border-strong");
  });

  test("toggles Ask scope checkboxes without opening note rows", async () => {
    render(<App />);

    await expandCategory("Work");

    fireEvent.click(screen.getByRole("checkbox", { name: "Use all notes for Ask" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Work note for Ask" }));

    expect(screen.getByText("1 note selected")).toBeInTheDocument();
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));

    expect(screen.getByText("Workspace mode: read-selected")).toBeInTheDocument();
  });

  test("keeps search tab presentation while search text is typed but not submitted", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });

    expect(searchbox).toHaveValue("work");
    expect(searchNotes).not.toHaveBeenCalled();
    expect(screen.queryByRole("tree", { name: "Browse notes" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Results for/)).not.toBeInTheDocument();
  });

  test("shows active search loading status", async () => {
    const search = deferred<SearchResult[]>();
    vi.mocked(searchNotes).mockReturnValueOnce(search.promise);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });
    fireEvent.submit(screen.getByRole("search"));

    expect(screen.queryByText("Search results", { selector: "span" })).not.toBeInTheDocument();
    expect(screen.getByText("Results for “work”", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Searching...", { selector: "span" })).toBeInTheDocument();

    search.resolve([]);
  });

  test("keeps rich note result cards while searching", async () => {
    vi.mocked(searchNotes).mockResolvedValueOnce([
      {
        ...notes[0],
        match_type: "hybrid",
        matched_snippet: "Matched work detail",
        score: 0.91,
      },
    ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => {
      expect(screen.getByText("Results for “work”", { selector: "span" })).toBeInTheDocument();
    });
    expect(screen.getByText("1 found")).toBeInTheDocument();

    const resultCard = screen.getByRole("button", { name: /Work note/ });

    expect(resultCard).toHaveTextContent("A note about work.");
    expect(resultCard).toHaveTextContent('Matched: "Matched work detail"');
    expect(resultCard).toHaveTextContent("Hybrid");
    expect(resultCard).toHaveTextContent("work");
    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).toBeInTheDocument();
  });

  test("keeps visible Ask source checkboxes across search and category changes", async () => {
    vi.mocked(searchNotes).mockResolvedValueOnce([
      {
        ...notes[0],
        match_type: "hybrid",
        matched_snippet: "Matched work detail",
        score: 0.91,
      },
    ]);

    render(<App />);

    await expandCategory("Work");

    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).toBeInTheDocument();

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => {
      expect(screen.getByText("Results for “work”", { selector: "span" })).toBeInTheDocument();
    });
    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.click(screen.getByRole("tab", { name: "Browse" }));
    fireEvent.click(screen.getByRole("button", { name: "Personal" }));

    expect(screen.getByRole("checkbox", { name: "Use Personal note for Ask" })).toBeInTheDocument();
  });

  test("category Ask source checkbox bulk-selects category notes", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Use Work category for Ask" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Use all notes for Ask" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Work category for Ask" }));

    expect(screen.getByText("1 note selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    fireEvent.click(screen.getByRole("button", { name: "Personal" }));
    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Use Personal note for Ask" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Use Work category for Ask" }));

    expect(screen.getByText("No sources selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).not.toBeChecked();
  });

  test("shows zero-result status and body copy for active search", async () => {
    vi.mocked(searchNotes).mockResolvedValueOnce([]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "missing" } });
    fireEvent.submit(screen.getByRole("search"));

    expect(await screen.findByText("Results for “missing”", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  test("shows failed search status while preserving the error body", async () => {
    vi.mocked(searchNotes).mockRejectedValueOnce(new Error("Search service unavailable."));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });
    fireEvent.submit(screen.getByRole("search"));

    expect(await screen.findByText("Results for “work”", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Search failed")).toBeInTheDocument();
    expect(screen.getByText("Search service unavailable.")).toBeInTheDocument();
  });

  test("confirms before leaving an unsaved selected-note edit from the sidebar action", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);

    render(<App />);

    await expandCategory("Work");

    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));
    await waitFor(() => {
      expect(screen.getByText("Loaded note: Work note")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Mock edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock dirty" }));
    expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();

    fireEvent.click(getSidebarNewNoteButton());
    expect(confirm).toHaveBeenCalledWith("Discard unsaved note changes?");
    expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();

    fireEvent.click(getSidebarNewNoteButton());
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();
  });
});
