import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { askQuestion, searchNotes } from "./api";
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
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn().mockResolvedValue(notes[0]),
  listCategories: vi.fn().mockResolvedValue(categories),
  listNotes: vi.fn().mockResolvedValue(notes),
  searchNotes: vi.fn().mockResolvedValue([]),
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
  test("organizes browsing as one expanded category tree with nested notes", async () => {
    render(<App />);

    const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
    const title = screen.getByText("Note Memory");
    const newNote = within(sidebar).getByRole("button", { name: "New note" });
    const search = screen.getByRole("search");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const tree = getBrowseTree();
    const allNotes = within(tree).getByRole("button", { name: "All notes" });
    const uncategorized = within(tree).getByRole("button", { name: "Uncategorized" });
    const personalCategory = within(tree).getByRole("button", { name: "Personal" });
    const personalNote = within(tree).getByRole("button", { name: /Personal note/ });
    const workCategory = within(tree).getByRole("button", { name: "Work" });
    const workNote = within(tree).getByRole("button", { name: /Work note/ });
    const askSources = screen.getByText("Ask sources");

    expect(sidebar).toContainElement(title);
    expect(sidebar).toContainElement(newNote);
    expect(title.compareDocumentPosition(newNote)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(newNote.compareDocumentPosition(search)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(title.compareDocumentPosition(search)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(search.compareDocumentPosition(askSources)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(askSources.compareDocumentPosition(tree)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(allNotes.compareDocumentPosition(uncategorized)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(uncategorized.compareDocumentPosition(personalCategory)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(personalCategory).toHaveAttribute("aria-expanded", "true");
    expect(personalCategory.compareDocumentPosition(personalNote)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(personalNote.compareDocumentPosition(workCategory)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(workCategory).toHaveAttribute("aria-expanded", "true");
    expect(workCategory.compareDocumentPosition(workNote)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test("keeps category navigation and scoped search behavior unchanged", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Uncategorized" }));

    expect(screen.getByText(/Scope: Uncategorized/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uncategorized" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expect(screen.getByText(/Scope: Work/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Work" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /Work note/ })).not.toBeInTheDocument();
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();

    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "react" } });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => {
      expect(searchNotes).toHaveBeenCalledWith("react", { category_id: 1 });
    });

    expect(screen.getByText("Results for “react”", { selector: "span" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchbox).toHaveValue("");
    expect(screen.getByText(/Scope: Work/)).toBeInTheDocument();
  });

  test("expands collapsed categories to reveal nested notes without opening them", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(screen.queryByRole("button", { name: /Work note/ })).not.toBeInTheDocument();
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    const workNote = screen.getByRole("button", { name: /Work note/ });

    expect(workNote).toBeInTheDocument();
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();
  });

  test("shows Ask source checkboxes without a selection mode", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

    expect(screen.getByText("Ask sources")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Work note for Ask" }));

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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));
    expect(screen.getByText("Workspace mode: read-selected")).toBeInTheDocument();

    fireEvent.click(getSidebarNewNoteButton());

    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();
  });

  test("shows compact note rows while browsing", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Use all notes for Ask" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Work note for Ask" }));

    expect(screen.getByText("1 note selected")).toBeInTheDocument();
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));

    expect(screen.getByText("Workspace mode: read-selected")).toBeInTheDocument();
  });

  test("keeps browsing presentation while search text is typed but not submitted", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });

    expect(searchbox).toHaveValue("work");
    expect(searchNotes).not.toHaveBeenCalled();
    expect(getBrowseTree()).toBeInTheDocument();
    expect(screen.queryByText(/Results for/)).not.toBeInTheDocument();

    const noteRow = screen.getByRole("button", { name: /Work note/ });
    expect(noteRow).not.toHaveTextContent("A note about work.");
  });

  test("shows active search loading status", async () => {
    const search = deferred<SearchResult[]>();
    vi.mocked(searchNotes).mockReturnValueOnce(search.promise);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });
    fireEvent.submit(screen.getByRole("search"));

    expect(await screen.findByText("Results for “work”", { selector: "span" })).toBeInTheDocument();
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
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).toBeInTheDocument();

    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => {
      expect(screen.getByText("Results for “work”", { selector: "span" })).toBeInTheDocument();
    });
    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.click(screen.getByRole("button", { name: "Personal" }));
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
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

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
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

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

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

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
