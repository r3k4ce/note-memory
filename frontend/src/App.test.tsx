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

function expectListHeading(label: string) {
  expect(
    screen
      .getAllByText(label, { selector: "span" })
      .some((element) => element.className.includes("uppercase")),
  ).toBe(true);
}

function getSidebarNewNoteButton() {
  return within(screen.getByRole("complementary", { name: "Notes sidebar" })).getByRole("button", {
    name: "New note",
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
  test("organizes the sidebar as navigation first with compact Ask scope in the note-list header", async () => {
    render(<App />);

    const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
    const title = screen.getByText("Note Memory");
    const newNote = within(sidebar).getByRole("button", { name: "New note" });
    const search = screen.getByRole("search");
    const notesHeading = screen.getByText("Notes");
    const allNotes = screen.getByRole("button", { name: "All notes" });
    const uncategorized = screen.getByRole("button", { name: "Uncategorized" });
    const categoriesHeading = screen.getByText("Categories");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const workCategory = screen.getByRole("button", { name: "Work" });
    const askScope = screen.getByText("Ask scope: All notes");
    const listHeading = screen.getByText("All notes", { selector: "span" });

    expect(sidebar).toContainElement(title);
    expect(sidebar).toContainElement(newNote);
    expect(title.compareDocumentPosition(newNote)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(newNote.compareDocumentPosition(search)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(title.compareDocumentPosition(search)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(search.compareDocumentPosition(notesHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(notesHeading.compareDocumentPosition(allNotes)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(allNotes.compareDocumentPosition(uncategorized)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(uncategorized.compareDocumentPosition(categoriesHeading)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(categoriesHeading.compareDocumentPosition(workCategory)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(workCategory.compareDocumentPosition(listHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(listHeading.compareDocumentPosition(askScope)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test("keeps category navigation and scoped search behavior unchanged", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Uncategorized" }));

    expect(screen.getByText("Uncategorized", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(/Scope: Uncategorized/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Work" }));

    expectListHeading("Work");
    expect(screen.getByText(/Scope: Work/)).toBeInTheDocument();

    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "react" } });
    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => {
      expect(searchNotes).toHaveBeenCalledWith("react", { category_id: 1 });
    });

    expect(screen.getByText("Results for “react”", { selector: "span" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchbox).toHaveValue("");
    expectListHeading("Work");
  });

  test("keeps compact Ask note scope controls and selected-note payload behavior unchanged", async () => {
    vi.mocked(askQuestion).mockResolvedValue({
      answer: "Saved notes mention work.",
      sources: [],
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    });

    expect(screen.getByText("Ask scope: All notes")).toBeInTheDocument();
    expect(screen.getByText("Mock Ask scope: All notes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mock ask" }));

    await waitFor(() => {
      expect(askQuestion).toHaveBeenCalledWith(
        expect.not.objectContaining({ note_ids: expect.anything() }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByText("Ask scope: None selected")).toBeInTheDocument();
    expect(screen.getByText("Select at least one note for Ask")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock ask" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Include Work note in Ask scope" }));

    expect(screen.getByText("Ask scope: 1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock ask" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Mock ask" }));

    await waitFor(() => {
      expect(askQuestion).toHaveBeenLastCalledWith(expect.objectContaining({ note_ids: [10] }));
    });

    fireEvent.click(screen.getByRole("button", { name: "All" }));

    expect(screen.getByText("Ask scope: All notes")).toBeInTheDocument();
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
    expect(noteRow).toHaveTextContent("Work");
    expect(noteRow).not.toHaveTextContent("A note about work.");
    expect(noteRow).not.toHaveTextContent("work");
    expect(screen.getByRole("checkbox", { name: "Include Work note in Ask scope" })).toBeInTheDocument();

    fireEvent.click(noteRow);

    expect(screen.getByText("Workspace mode: read-selected")).toBeInTheDocument();
    expect(noteRow.className).toContain("border-border-strong");
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
    expectListHeading("All notes");
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
