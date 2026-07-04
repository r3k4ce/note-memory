import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { searchNotes } from "./api";
import App from "./App";
import type { Category, Note } from "./types";

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
  AskChat() {
    return <section aria-label="Ask chat" />;
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

describe("App sidebar navigation", () => {
  test("organizes the sidebar as app header, search, note navigation, category navigation, Ask scope, and note list", async () => {
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
    const askScope = screen.getByText("Ask scope · All notes");
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
    expect(workCategory.compareDocumentPosition(askScope)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(askScope.compareDocumentPosition(listHeading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
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

    expect(screen.getByText("Results · react", { selector: "span" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(searchbox).toHaveValue("");
    expectListHeading("Work");
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
