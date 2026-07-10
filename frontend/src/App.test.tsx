import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createNote,
  getNote,
  searchNotes,
  updateNote,
} from "./api";
import App from "./App";
import type { Category, Note } from "./types";

const styleCss = readFileSync("src/style.css", "utf8");
const markdownPaneSource = readFileSync("src/components/MarkdownPane.tsx", "utf8");
const markdownPageSurfaceSource = readFileSync("src/components/MarkdownPageSurface.tsx", "utf8");

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
      needs_ai_organization: false,
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
      needs_ai_organization: false,
    },
  ];

  return { categories: mockCategories, notes: mockNotes };
});

vi.mock("./api", () => ({
  askQuestion: vi.fn(),
  createChatThread: vi.fn().mockResolvedValue({
    id: 3,
    title: "Untitled chat",
    scope: { mode: "all" },
    created_at: "2026-07-03T00:00:00Z",
    updated_at: "2026-07-03T00:00:00Z",
  }),
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  deleteChatThread: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn().mockResolvedValue(notes[0]),
  getChatThreadMessages: vi.fn().mockResolvedValue([]),
  listCategories: vi.fn().mockResolvedValue(categories),
  listChatThreads: vi.fn().mockResolvedValue([
    {
      id: 1,
      title: "General",
      scope: { mode: "all" },
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    },
  ]),
  listNotes: vi.fn().mockResolvedValue(notes),
  organizeNote: vi.fn(),
  searchNotes: vi.fn().mockResolvedValue([]),
  updateCategory: vi.fn(),
  updateChatThread: vi.fn().mockResolvedValue({
    id: 1,
    title: "General",
    scope: { mode: "all" },
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  }),
  updateNote: vi.fn(),
}));

vi.mock("./features/ask/AskChat", () => ({
  AskChat({
    isSubmitDisabled,
    messages,
    activeThreadId,
    threads,
    onDeleteThread,
    onNewThread,
    onRenameThread,
    onSourceSelect,
    onSubmit,
    onThreadChange,
    scopeLabel,
    submitDisabledMessage,
  }: {
    isSubmitDisabled?: boolean;
    messages: { content: string }[];
    activeThreadId: number | null;
    threads: { id: number; title: string }[];
    onDeleteThread: (threadId: number) => void;
    onNewThread: () => void;
    onRenameThread: (threadId: number, newTitle: string) => void;
    onSourceSelect: (noteId: number) => void;
    onSubmit: (question: string) => void;
    onThreadChange: (threadId: number) => void;
    scopeLabel: string;
    submitDisabledMessage?: string;
  }) {
    return (
      <section aria-label="Ask chat">
        <span>Mock Ask scope: {scopeLabel}</span>
        {submitDisabledMessage ? <span>{submitDisabledMessage}</span> : null}
        {messages.map((message, index) => (
          <span key={`${index}:${message.content}`}>{message.content}</span>
        ))}
        <span>Mock active thread: {activeThreadId}</span>
        <span>Mock thread count: {threads.length}</span>
        <button disabled={isSubmitDisabled} onClick={() => onSubmit("What did I save?")} type="button">
          Mock ask
        </button>
        <button onClick={() => onThreadChange(2)} type="button">Mock switch thread</button>
        <button onClick={onNewThread} type="button">Mock new chat</button>
        <button onClick={() => onRenameThread(activeThreadId ?? 1, "Renamed chat")} type="button">Mock rename chat</button>
        <button onClick={() => onDeleteThread(activeThreadId ?? 1)} type="button">Mock delete chat</button>
        <button onClick={() => onSourceSelect(10)} type="button">Mock open citation</button>
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
    onDraftTextChange,
    onSave,
    onSaveEdit,
    draftText,
    readMode,
    toolbarControls,
  }: {
    mode: string;
    note: Note | null;
    onEditDirtyChange: (isDirty: boolean) => void;
    onEdit: () => void;
    onDraftTextChange: (value: string) => void;
    onSave: () => void;
    onSaveEdit: (body: {
      original_text: string;
      ai_title: string;
      short_summary: string;
      tags: string[];
      category_id: number | null;
    }) => Promise<void>;
    draftText: string;
    readMode: boolean;
    toolbarControls: ReactNode;
  }) {
    return (
      <section aria-label="Note workspace" data-mode={mode}>
        {toolbarControls}
        <span>Workspace mode: {mode}</span>
        <span>Read mode: {String(readMode)}</span>
        <span>Draft text: {draftText}</span>
        {note ? <span>Loaded note: {note.ai_title}</span> : null}
        <button onClick={onEdit} type="button">
          Mock edit
        </button>
        <button onClick={() => onEditDirtyChange(true)} type="button">
          Mock dirty
        </button>
        <button
          onClick={() => onDraftTextChange(["---", "title: Saved note", "---", "", "Saved body"].join("\n"))}
          type="button"
        >
          Mock draft
        </button>
        <button
          onClick={onSave}
          type="button"
        >
          Mock save note
        </button>
        <button
          onClick={() =>
            void onSaveEdit({
              original_text: "Updated body",
              ai_title: "Updated note",
              short_summary: "Updated summary",
              tags: ["updated"],
              category_id: null,
            })
          }
          type="button"
        >
          Mock save edit
        </button>
      </section>
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function getSidebarNewNoteButton() {
  return within(screen.getByRole("complementary", { name: "Notes sidebar" })).getByRole("button", {
    name: "New note",
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

function getCssBlock(source: string, selector: string) {
  const selectorIndex = source.indexOf(selector);
  if (selectorIndex === -1) {
    return "";
  }

  const blockStart = source.indexOf("{", selectorIndex);
  if (blockStart === -1) {
    return "";
  }

  let depth = 0;
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(selectorIndex, index + 1);
      }
    }
  }

  return "";
}

describe("App sidebar navigation", () => {
  test("frames both side panes with the cohesive workspace shell", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    expect(container.firstElementChild).toHaveClass("workspace-root");
    expect(screen.getByRole("complementary", { name: "Notes sidebar" })).toHaveClass(
      "workspace-side-pane",
      "workspace-page-shell",
    );
    expect(screen.getByRole("complementary", { name: "Bun pane" })).toHaveClass(
      "workspace-side-pane",
      "workspace-page-shell",
    );
  });

  test("defines distinct theme photo textures only for the workspace background layer", () => {
    const defaultThemeRule = getCssBlock(styleCss, "@theme");
    const darkThemeRule = getCssBlock(styleCss, '[data-theme="dark"]');
    const forestThemeRule = getCssBlock(styleCss, '[data-theme="forest"]');
    const solarizedThemeRule = getCssBlock(styleCss, '[data-theme="solarized"]');
    const themeRules = [defaultThemeRule, darkThemeRule, forestThemeRule, solarizedThemeRule];
    const textureImages = themeRules.map(
      (rule) => rule.match(/--workspace-bg-image:\s*([^;]+);/)?.[1] ?? "",
    );

    for (const rule of themeRules) {
      expect(rule).toContain("--workspace-bg-image:");
      expect(rule).toContain("--workspace-bg-size:");
      expect(rule).toContain("--workspace-bg-position:");
      expect(rule).not.toContain("gradient(");
      expect(rule).not.toContain("data:image/svg+xml");
    }
    expect(new Set(textureImages).size).toBe(themeRules.length);
    expect(textureImages).toEqual([
      'url("./assets/backgrounds/workspace-biscuit.png")',
      'url("./assets/backgrounds/workspace-cocoa.png")',
      'url("./assets/backgrounds/workspace-matcha.png")',
      'url("./assets/backgrounds/workspace-honey.png")',
    ]);
  });

  test("keeps workspace textures behind solid pane and page surfaces", () => {
    const workspaceRootRule = getCssBlock(styleCss, ".workspace-root");
    const workspaceCenterRule = getCssBlock(styleCss, ".workspace-center");
    const workspaceCenterContentRule = getCssBlock(styleCss, ".workspace-center-content");
    const workspacePaneRule = getCssBlock(styleCss, ".workspace-side-pane");
    const markdownPageRule = getCssBlock(styleCss, ".markdown-page-surface");
    const workspaceShellRule = getCssBlock(styleCss, ".workspace-page-shell");

    expect(workspaceRootRule).toContain("background-color: var(--color-bg)");
    expect(workspaceRootRule).toContain("background-image: var(--workspace-bg-image)");
    expect(workspaceRootRule).toContain("background-size: var(--workspace-bg-size)");
    expect(workspaceRootRule).toContain("background-position: var(--workspace-bg-position)");
    expect(workspaceRootRule).toContain("background-repeat: no-repeat");
    expect(workspaceCenterRule).toContain("background: transparent");
    expect(workspaceCenterContentRule).toContain("transition:");
    expect(workspaceCenterContentRule).toContain("width var(--duration-150) var(--ease-out)");
    expect(workspacePaneRule).toContain("background-color: var(--color-panel-soft)");
    expect(markdownPageRule).toContain("background-color: var(--color-page)");
    expect(workspaceShellRule).not.toContain("background-image");
    expect(workspacePaneRule).not.toContain("background-image");
    expect(markdownPageRule).not.toContain("background-image");
  });

  test("shares workspace page shell edges across side panes and markdown panes", () => {
    const workspacePaneRule = styleCss.match(/\.workspace-side-pane\s*\{[^}]+\}/)?.[0] ?? "";
    const markdownPageRule = styleCss.match(/\.markdown-page-surface\s*\{[^}]+\}/)?.[0] ?? "";
    const desktopMarkdownPageRule =
      styleCss.match(/@media \(min-width: 48rem\)\s*\{\s*\.markdown-page-surface\s*\{[^}]+\}\s*\}/)?.[0] ??
      "";
    const noteToolbarOverlayRule = styleCss.match(/\.note-toolbar-overlay\s*\{[^}]+\}/)?.[0] ?? "";
    const workspaceShellRule = styleCss.match(/\.workspace-page-shell\s*\{[^}]+\}/)?.[0] ?? "";
    const collapsedPaneRule = styleCss.match(/\.workspace-side-pane-collapsed\s*\{[^}]+\}/)?.[0] ?? "";

    expect(styleCss).toContain("--spacing-workspace-page");
    expect(workspacePaneRule).toContain("margin-block: var(--spacing-workspace-page)");
    expect(markdownPageRule).toContain("margin: var(--spacing-workspace-page) auto");
    expect(desktopMarkdownPageRule).toContain("max-width: none");
    expect(desktopMarkdownPageRule).toContain("margin-inline: var(--spacing-workspace-page)");
    expect(desktopMarkdownPageRule).not.toContain("margin: var(--spacing-workspace-page) auto");
    expect(markdownPageRule).toContain("overflow: hidden");
    expect(noteToolbarOverlayRule).toContain("position: absolute");
    expect(noteToolbarOverlayRule).toContain("top: 0");
    expect(workspaceShellRule).toContain("border: 1px solid var(--color-page-border)");
    expect(workspaceShellRule).toContain("border-radius: var(--radius-card)");
    expect(workspaceShellRule).toContain("box-shadow: var(--shadow-page)");
    expect(collapsedPaneRule).toContain("border-color: transparent");
    expect(collapsedPaneRule).toContain("box-shadow: none");
  });

  test("keeps markdown surface scroll fades passive and below the toolbar", () => {
    const beforeFadeRule = getCssBlock(styleCss, ".markdown-page-surface::before");
    const afterFadeRule = getCssBlock(styleCss, ".markdown-page-surface::after");
    const sideFadeRule = getCssBlock(styleCss, ".markdown-page-side-fades");
    const desktopSideFadeRule =
      styleCss.match(/@media \(min-width: 48rem\)\s*\{\s*\.markdown-page-side-fades\s*\{[^}]+\}\s*\}/)?.[0] ??
      "";
    const noteToolbarOverlayRule = styleCss.match(/\.note-toolbar-overlay\s*\{[^}]+\}/)?.[0] ?? "";

    expect(beforeFadeRule).not.toBe("");
    expect(afterFadeRule).not.toBe("");
    expect(sideFadeRule).not.toBe("");
    expect(markdownPageSurfaceSource).toContain('className="markdown-page-side-fades"');
    expect(markdownPageSurfaceSource).toContain('aria-hidden="true"');
    for (const fadeRule of [beforeFadeRule, afterFadeRule]) {
      expect(fadeRule).toContain('content: ""');
      expect(fadeRule).toContain("position: absolute");
      expect(fadeRule).toContain("pointer-events: none");
      expect(fadeRule).toContain("background-color: var(--color-page)");
      expect(fadeRule).toContain("mask-image: linear-gradient");
      expect(fadeRule).toContain("-webkit-mask-image: linear-gradient");
      expect(fadeRule).toContain("z-index: 1");
    }
    expect(beforeFadeRule).toContain("top: 0");
    expect(beforeFadeRule).toContain("height: var(--spacing-markdown-page-top)");
    expect(beforeFadeRule).toContain(
      "mask-image: linear-gradient(to bottom, black, rgba(0, 0, 0, 0.8) 3rem, rgba(0, 0, 0, 0.45) 4.25rem, transparent 5rem)",
    );
    expect(beforeFadeRule).toContain(
      "-webkit-mask-image: linear-gradient(to bottom, black, rgba(0, 0, 0, 0.8) 3rem, rgba(0, 0, 0, 0.45) 4.25rem, transparent 5rem)",
    );
    expect(afterFadeRule).toContain("bottom: 0");
    expect(afterFadeRule).toContain("height: 3rem");
    expect(sideFadeRule).toContain("position: absolute");
    expect(sideFadeRule).toContain("inset: 0");
    expect(sideFadeRule).toContain("z-index: 1");
    expect(sideFadeRule).toContain("pointer-events: none");
    expect(sideFadeRule).toContain("display: none");
    expect(sideFadeRule).toContain("background:");
    expect(sideFadeRule).toContain("linear-gradient(to right, var(--color-page), transparent)");
    expect(sideFadeRule).toContain("linear-gradient(to left, var(--color-page), transparent)");
    expect(sideFadeRule).toContain("background-size: 1.5rem 100%, 1.5rem 100%");
    expect(desktopSideFadeRule).toContain(".markdown-page-side-fades");
    expect(desktopSideFadeRule).toContain("display: block");
    expect(noteToolbarOverlayRule).toContain("z-index: 10");
  });

  test("keeps reusable surface styling on explicit classes instead of broad selectors", () => {
    const markdownBaseRules = styleCss.match(/\.markdown-codemirror\s*\{/g) ?? [];
    const surfaceCardRule = styleCss.match(/\.surface-card\s*\{[^}]+\}/)?.[0] ?? "";
    const surfaceInputRule = styleCss.match(/\.surface-input\s*\{[^}]+\}/)?.[0] ?? "";
    const surfacePopoverRule = styleCss.match(/\.surface-popover\s*\{[^}]+\}/)?.[0] ?? "";

    expect(markdownBaseRules).toHaveLength(1);
    expect(surfaceCardRule).toContain("background-color: var(--color-surface)");
    expect(surfaceCardRule).toContain("border: 1px solid var(--color-border)");
    expect(surfaceInputRule).toContain("min-height: 2.25rem");
    expect(surfaceInputRule).toContain("border: 1px solid var(--color-border)");
    expect(surfacePopoverRule).toContain("box-shadow: var(--shadow-soft)");
    expect(styleCss).not.toContain('[aria-labelledby="ask-title"] > div');
    expect(styleCss).not.toContain('section[aria-labelledby="ask-title"] form');
    expect(styleCss).not.toContain('[role="separator"] > div');
    expect(styleCss).not.toContain('[role="menu"]');
    expect(styleCss).not.toContain('input[type="text"]');
    expect(styleCss).not.toContain('input[type="search"]');
    expect(styleCss).not.toContain("input:not([type])");
  });

  test("places reusable component classes in Tailwind's components layer", () => {
    const componentsLayer = getCssBlock(styleCss, "@layer components");
    const componentClassNames = [
      "workspace-page-shell",
      "surface-card",
      "surface-input",
      "surface-popover",
      "markdown-page-surface",
      "note-toolbar-overlay",
      "markdown-codemirror",
      "markdown-codemirror-workspace",
      "workspace-side-pane",
      "workspace-side-pane-collapsed",
      "resize-handle-grip",
      "resize-handle-grip-snapped",
      "note-toolbar-error",
      "note-slip",
      "note-preview",
      "note-frontmatter",
      "sidebar-row",
    ];

    expect(componentsLayer).not.toBe("");
    for (const className of componentClassNames) {
      expect(componentsLayer).toContain(`.${className}`);
    }
  });

  test("keeps workspace edit and read surfaces on the same internal scroll contract", () => {
    const workspaceEditorRule = styleCss.match(/\.markdown-codemirror-workspace\s*\{[^}]+\}/)?.[0] ?? "";
    const workspaceScrollerRule =
      styleCss.match(/\.markdown-codemirror-workspace \.cm-scroller\s*\{[^}]+\}/)?.[0] ?? "";
    const workspaceContentRule =
      styleCss.match(/\.markdown-codemirror-workspace \.cm-content\s*\{[^}]+\}/)?.[0] ?? "";
    const notePreviewRule = styleCss.match(/\.note-preview\s*\{[^}]+\}/)?.[0] ?? "";

    expect(styleCss).toContain("--spacing-markdown-page-top: 5rem");
    expect(workspaceEditorRule).toContain("display: flex");
    expect(workspaceEditorRule).toContain("flex-direction: column");
    expect(workspaceScrollerRule).toContain("flex: 1");
    expect(workspaceScrollerRule).toContain("height: auto");
    expect(workspaceScrollerRule).toContain("overflow: auto");
    expect(workspaceContentRule).toContain(
      "padding: var(--spacing-markdown-page-top) clamp(1.5rem, 5vw, 4rem) clamp(1.5rem, 5vw, 4rem)",
    );
    expect(notePreviewRule).toContain("flex: 1");
    expect(notePreviewRule).toContain("overflow-y: auto");
    expect(notePreviewRule).toContain("min-height: 0");
    expect(notePreviewRule).toContain(
      "padding: var(--spacing-markdown-page-top) clamp(1.5rem, 5vw, 4rem) clamp(1.5rem, 5vw, 4rem) !important",
    );
    expect(styleCss).toContain(".note-preview.prose");
    expect(styleCss).not.toContain(".note-preview .prose");
  });

  test("scopes the editor viewport clamp outside the workspace markdown pane", () => {
    const containedScrollerRule =
      styleCss.match(/\.markdown-codemirror:not\(\.markdown-codemirror-workspace\) \.cm-scroller\s*\{[^}]+\}/)?.[0] ??
      "";
    const workspaceScrollerRule =
      styleCss.match(/\.markdown-codemirror-workspace \.cm-scroller\s*\{[^}]+\}/)?.[0] ?? "";

    expect(containedScrollerRule).toContain("max-height: clamp(24rem, calc(100vh - 18rem), 40rem)");
    expect(workspaceScrollerRule).toContain("max-height: none");
    expect(markdownPaneSource).not.toContain('maxHeight: "clamp');
  });

  test("keeps read mode prose full width and frontmatter compact", () => {
    const notePreviewProseRule = styleCss.match(/\.note-preview\.prose\s*\{[^}]+\}/)?.[0] ?? "";
    const frontmatterRule = styleCss.match(/\.note-preview\.prose :where\(\.note-frontmatter\)\s*\{[^}]+\}/)?.[0] ?? "";

    expect(notePreviewProseRule).toContain("max-width: none");
    expect(frontmatterRule).toContain("width: 100%");
    expect(frontmatterRule).toContain("margin-top: 0");
  });

  test("toggles read mode from the top toolbar for new notes and selected notes", async () => {
    render(<App />);

    await expandCategory("Work");

    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();
    expect(screen.getByText("Read mode: false")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Read Mode" }));
    expect(screen.getByText("Read mode: true")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit Mode" }));
    expect(screen.getByText("Read mode: false")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));

    await waitFor(() => {
      expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();
    });
    expect(screen.getByText("Read mode: false")).toBeInTheDocument();
  });

  test("keeps the selected read or edit mode when opening new notes and saving", async () => {
    vi.mocked(createNote).mockResolvedValueOnce(notes[0]);
    vi.mocked(updateNote).mockResolvedValueOnce({ ...notes[0], ai_title: "Updated note" });

    render(<App />);

    await expandCategory("Work");

    fireEvent.click(screen.getByRole("button", { name: "Read Mode" }));
    expect(screen.getByText("Read mode: true")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));
    await waitFor(() => {
      expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();
    });
    expect(screen.getByText("Read mode: true")).toBeInTheDocument();

    fireEvent.click(getSidebarNewNoteButton());
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();
    expect(screen.getByText("Read mode: true")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mock draft" }));
    await waitFor(() => {
      expect(screen.getByText(/Saved body/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Mock save note" }));
    await waitFor(() => {
      expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();
    });
    expect(createNote).toHaveBeenCalledWith({
      original_text: "Saved body",
      ai_title: "Saved note",
      category_id: 1,
    });
    expect(screen.getByText("Read mode: true")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mock save edit" }));
    await waitFor(() => {
      expect(updateNote).toHaveBeenCalled();
    });
    expect(screen.getByText("Read mode: true")).toBeInTheDocument();
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

  test("opens cited notes through the existing notebook coordination flow", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });

    fireEvent.click(screen.getByRole("button", { name: "Mock open citation" }));

    expect(searchbox).toHaveValue("");
    expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();
    expect(await screen.findByText("Loaded note: Work note")).toBeInTheDocument();
  });

  test("preserves active search when dirty-edit citation navigation is cancelled", async () => {
    vi.mocked(getNote).mockResolvedValueOnce(notes[1]);
    vi.mocked(searchNotes).mockResolvedValueOnce([
      {
        ...notes[0],
        score: 0.82,
        match_type: "fuzzy",
        matched_snippet: "Work note body",
      },
    ]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    await expandCategory("Personal");
    fireEvent.click(screen.getByRole("button", { name: /Personal note/ }));
    expect(await screen.findByText("Loaded note: Personal note")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mock dirty" }));

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(searchNotes).toHaveBeenCalledWith("work"));
    expect(within(screen.getByRole("complementary", { name: "Notes sidebar" })).getByText("Work note")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mock open citation" }));

    expect(confirm).toHaveBeenCalledWith("Discard unsaved note changes?");
    expect(screen.getByText("Loaded note: Personal note")).toBeInTheDocument();
    expect(searchbox).toHaveValue("work");
    expect(screen.getByText("Results for “work”", { selector: "span" })).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "Notes sidebar" })).getByText("Work note")).toBeInTheDocument();
  });

  test("adds product polish primitives without transition-all or sliced visible dates", () => {
    expect(styleCss).toContain(".bun-mark");
    expect(styleCss).toContain(".ask-scope-checkbox");
    expect(styleCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styleCss).not.toContain("transition-all");
    expect(readFileSync("src/components/NoteCard.tsx", "utf8")).not.toContain("date_added.slice");
    expect(readFileSync("src/features/ask/AskChat.tsx", "utf8")).not.toContain("date_added.slice");
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

  test("opens the existing new-note workspace from the sidebar action", async () => {
    render(<App />);

    await expandCategory("Work");

    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));
    expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();

    fireEvent.click(getSidebarNewNoteButton());

    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();
  });

  test("toggles Ask scope checkboxes without opening note rows", async () => {
    render(<App />);

    await expandCategory("Work");

    fireEvent.click(screen.getByRole("checkbox", { name: "Use all notes for Ask" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Use Work note for Ask" }));

    expect(screen.getByText("1 note selected")).toBeInTheDocument();
    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));

    expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();
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

    expect(screen.getByText("No notes selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).not.toBeChecked();
  });

});
