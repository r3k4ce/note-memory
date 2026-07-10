import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  askQuestion,
  createNote,
  createCategory,
  deleteCategory,
  searchNotes,
  updateCategory,
  updateNote,
} from "./api";
import App from "./App";
import type { AskResponse, Category, Note, SearchResult } from "./types";

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
  createCategory: vi.fn(),
  deleteCategory: vi.fn(),
  createNote: vi.fn(),
  deleteNote: vi.fn(),
  getNote: vi.fn().mockResolvedValue(notes[0]),
  listCategories: vi.fn().mockResolvedValue(categories),
  listNotes: vi.fn().mockResolvedValue(notes),
  organizeNote: vi.fn(),
  searchNotes: vi.fn().mockResolvedValue([]),
  updateCategory: vi.fn(),
  updateNote: vi.fn(),
}));

vi.mock("./components/AskChat", () => ({
  AskChat({
    isSubmitDisabled,
    messages,
    onSubmit,
    scopeLabel,
    submitDisabledMessage,
  }: {
    isSubmitDisabled?: boolean;
    messages: { content: string }[];
    onSubmit: (question: string) => void;
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
  test("renders resizable pane separators and workspace layout controls", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const sidebarSeparator = screen.getByRole("separator", { name: "Resize notes sidebar" });
    const bunSeparator = screen.getByRole("separator", { name: "Resize Bun" });

    expect(sidebarSeparator).toBeInTheDocument();
    expect(bunSeparator).toBeInTheDocument();
    expect(sidebarSeparator).toHaveClass("absolute", "h-8", "w-3.5");
    expect(bunSeparator).toHaveClass("absolute", "h-8", "w-3.5");
    expect(sidebarSeparator).not.toHaveClass("w-2");
    expect(bunSeparator).not.toHaveClass("w-2");
    expect(sidebarSeparator.innerHTML).not.toContain("inset-y-0");
    expect(sidebarSeparator.innerHTML).not.toContain("w-px");
    expect(bunSeparator.innerHTML).not.toContain("inset-y-0");
    expect(bunSeparator.innerHTML).not.toContain("w-px");
    expect(screen.queryByRole("button", { name: "Show all panes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Focus Mode" })).toBeInTheDocument();
  });

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

  test("focuses the text area while keeping resize handles available, then restores panes", async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
    const assistant = screen.getByRole("complementary", { name: "Bun pane" });
    const centerContent = container.querySelector(".workspace-center-content");

    expect(centerContent).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shrink editor" })).not.toBeInTheDocument();

    vi.spyOn(centerContent as HTMLElement, "getBoundingClientRect").mockReturnValue({
      bottom: 900,
      height: 900,
      left: 320,
      right: 1088,
      toJSON: () => ({}),
      top: 0,
      width: 768,
      x: 320,
      y: 0,
    });

    fireEvent.click(screen.getByRole("button", { name: "Focus Mode" }));

    expect(sidebar).toHaveStyle({ width: "0px" });
    expect(assistant).toHaveStyle({ width: "0px" });
    expect(screen.getByRole("separator", { name: "Resize notes sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize Bun" })).toBeInTheDocument();
    const shrinkEditor = screen.getByRole("button", { name: "Shrink editor" });
    expect(screen.getByRole("button", { name: "Exit" })).toBeInTheDocument();
    expect(shrinkEditor).toHaveAttribute("title", "Shrink editor");
    expect(shrinkEditor.previousElementSibling).toHaveAttribute("aria-label", "Read Mode");
    expect(shrinkEditor.nextElementSibling).toHaveAttribute("aria-label", "Exit");

    fireEvent.click(shrinkEditor);
    expect(centerContent).toHaveStyle({ width: "768px" });
    expect(screen.getByRole("button", { name: "Expand editor" })).toHaveAttribute(
      "title",
      "Expand editor",
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand editor" }));
    expect(centerContent).toHaveStyle({ width: "100%" });
    expect(screen.getByRole("button", { name: "Shrink editor" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Shrink editor" }));
    expect(screen.getByRole("button", { name: "Expand editor" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Exit" }));

    expect(sidebar).toHaveStyle({ width: "320px" });
    expect(assistant).toHaveStyle({ width: "352px" });
    expect(screen.getByRole("button", { name: "Focus Mode" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shrink editor" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Focus Mode" }));
    expect(screen.getByRole("button", { name: "Shrink editor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand editor" })).not.toBeInTheDocument();
  });

  test("shows an expanded focus-width control after resize-grip entry and resets after a pane reopens", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const notesSeparator = screen.getByRole("separator", { name: "Resize notes sidebar" });
    const bunSeparator = screen.getByRole("separator", { name: "Resize Bun" });

    fireEvent.pointerDown(notesSeparator, { clientX: 320, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 20, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(screen.queryByRole("button", { name: "Shrink editor" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Focus Mode" })).toBeInTheDocument();

    fireEvent.pointerDown(bunSeparator, { clientX: 1088, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 1440, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Shrink editor" }));
    expect(screen.getByRole("button", { name: "Expand editor" })).toBeInTheDocument();

    fireEvent.pointerDown(notesSeparator, { clientX: 0, pointerId: 3 });
    fireEvent.pointerMove(window, { clientX: 240, pointerId: 3 });
    fireEvent.pointerUp(window, { pointerId: 3 });

    expect(screen.queryByRole("button", { name: "Expand editor" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Shrink editor" })).not.toBeInTheDocument();

    fireEvent.pointerDown(notesSeparator, { clientX: 240, pointerId: 4 });
    fireEvent.pointerMove(window, { clientX: 0, pointerId: 4 });
    fireEvent.pointerUp(window, { pointerId: 4 });

    expect(screen.getByRole("button", { name: "Shrink editor" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand editor" })).not.toBeInTheDocument();
  });

  test("snaps the notes sidebar to its desktop default while dragged near it", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
    const separator = screen.getByRole("separator", { name: "Resize notes sidebar" });

    fireEvent.pointerDown(separator, { clientX: 320, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 306, pointerId: 1 });

    expect(sidebar).toHaveStyle({ width: "320px" });
    expect(separator).toHaveClass("resize-handle-grip-snapped");

    fireEvent.pointerMove(window, { clientX: 292, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(sidebar).toHaveStyle({ width: "292px" });
    expect(separator).not.toHaveClass("resize-handle-grip-snapped");
  });

  test("snaps the Bun pane to its desktop default while dragged near it", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const assistant = screen.getByRole("complementary", { name: "Bun pane" });
    const separator = screen.getByRole("separator", { name: "Resize Bun" });

    fireEvent.pointerDown(separator, { clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 915, pointerId: 1 });

    expect(assistant).toHaveStyle({ width: "352px" });
    expect(separator).toHaveClass("resize-handle-grip-snapped");

    fireEvent.pointerMove(window, { clientX: 929, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(assistant).toHaveStyle({ width: "323px" });
    expect(separator).not.toHaveClass("resize-handle-grip-snapped");
  });

  test("keeps desktop pane resizing continuous outside the default snap zone", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
    const assistant = screen.getByRole("complementary", { name: "Bun pane" });

    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize notes sidebar" }), {
      clientX: 320,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 337, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(sidebar).toHaveStyle({ width: "337px" });

    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize Bun" }), {
      clientX: 900,
      pointerId: 2,
    });
    fireEvent.pointerMove(window, { clientX: 883, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    expect(assistant).toHaveStyle({ width: "369px" });
  });

  test("does not snap pane resizing below the desktop breakpoint", async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });

    try {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
      });

      const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });

      fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize notes sidebar" }), {
        clientX: 320,
        pointerId: 1,
      });
      fireEvent.pointerMove(window, { clientX: 306, pointerId: 1 });
      fireEvent.pointerUp(window, { pointerId: 1 });

      expect(sidebar).toHaveStyle({ width: "306px" });
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    }
  });

  test("Focus Mode restores snapped desktop default pane widths", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
    const assistant = screen.getByRole("complementary", { name: "Bun pane" });

    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize notes sidebar" }), {
      clientX: 320,
      pointerId: 1,
    });
    fireEvent.pointerMove(window, { clientX: 306, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    fireEvent.pointerDown(screen.getByRole("separator", { name: "Resize Bun" }), {
      clientX: 900,
      pointerId: 2,
    });
    fireEvent.pointerMove(window, { clientX: 915, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Focus Mode" }));
    expect(sidebar).toHaveStyle({ width: "0px" });
    expect(assistant).toHaveStyle({ width: "0px" });

    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(sidebar).toHaveStyle({ width: "320px" });
    expect(assistant).toHaveStyle({ width: "352px" });
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

  test("collapses and restores the notes sidebar by dragging its separator", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const sidebar = screen.getByRole("complementary", { name: "Notes sidebar" });
    const separator = screen.getByRole("separator", { name: "Resize notes sidebar" });

    fireEvent.pointerDown(separator, { clientX: 288, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 20, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(sidebar).toHaveStyle({ width: "0px" });

    fireEvent.pointerDown(separator, { clientX: 0, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 240, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    expect(sidebar).toHaveStyle({ width: "240px" });
  });

  test("collapses and restores the Bun pane by dragging its separator", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    const assistant = screen.getByRole("complementary", { name: "Bun pane" });
    const separator = screen.getByRole("separator", { name: "Resize Bun" });

    fireEvent.pointerDown(separator, { clientX: 600, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 940, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(assistant).toHaveStyle({ width: "0px" });

    fireEvent.pointerDown(separator, { clientX: 940, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 620, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    expect(assistant).toHaveStyle({ width: "320px" });
  });

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
    const title = screen.getByText("Notebun");
    const brandMark = within(sidebar).getByLabelText("Notebun Bun mark");
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
    expect(brandMark).toHaveClass("bun-mark");
    expect(brandMark.querySelector(".bun-mark-ear-left")).not.toBeNull();
    expect(brandMark.querySelector(".bun-mark-ear-right")).not.toBeNull();
    expect(brandMark.querySelector(".bun-mark-face")).not.toBeNull();
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

  test("adds product polish primitives without transition-all or sliced visible dates", () => {
    expect(styleCss).toContain(".bun-mark");
    expect(styleCss).toContain(".ask-scope-checkbox");
    expect(styleCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styleCss).not.toContain("transition-all");
    expect(readFileSync("src/components/NoteCard.tsx", "utf8")).not.toContain("date_added.slice");
    expect(readFileSync("src/components/AskChat.tsx", "utf8")).not.toContain("date_added.slice");
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

  test("deletes categories and uncategorizes their notes after confirmation", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    vi.mocked(deleteCategory).mockResolvedValueOnce({
      id: 1,
      deleted: true,
      deleted_note_ids: [],
      uncategorized_note_ids: [10],
      vector_cleanup: "deleted",
    });

    render(<App />);

    await expandCategory("Work");
    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));
    expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Categories" }));
    const manager = screen.getByRole("region", { name: "Manage categories" });
    fireEvent.click(within(manager).getByRole("button", { name: "Delete Work" }));

    await waitFor(() => {
      expect(deleteCategory).toHaveBeenCalledWith(1);
    });
    expect(confirm).toHaveBeenCalledWith('Delete "Work" and uncategorize its 1 note?');
    expect(screen.queryByRole("button", { name: "Work" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Uncategorized" }));
    expect(screen.getByRole("button", { name: /Work note/ })).toBeInTheDocument();
    expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();
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
    const ask = deferred<AskResponse>();
    vi.mocked(askQuestion).mockReturnValue(ask.promise);
    const askResponse: AskResponse = {
      answer: "Saved notes mention work.",
      status: "answered",
      evidence_summary: { source_count: 0, snippet_count: 0, match_types: [] },
      sources: [],
    };

    render(<App />);

    await expandCategory("Work");

    expect(screen.queryByText("Ask sources")).not.toBeInTheDocument();
    expect(screen.getByText("Mock Ask scope: All notes")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    fireEvent.click(screen.getByRole("button", { name: "Mock ask" }));

    expect(await screen.findByText(/I'm sniffing through the right notes/)).toBeInTheDocument();
    expect(screen.getByText(/I'm checking the evidence/)).toBeInTheDocument();
    expect(screen.getByText(/I'm drafting a grounded answer/)).toBeInTheDocument();

    await waitFor(() => {
      expect(askQuestion).toHaveBeenCalledWith(
        expect.not.objectContaining({
          category_id: expect.anything(),
          note_ids: expect.anything(),
          uncategorized: expect.anything(),
        }),
      );
    });

    ask.resolve(askResponse);
    await waitFor(() => {
      expect(screen.queryByText(/I'm sniffing through the right notes/)).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Use all notes for Ask" }));

    expect(screen.getByText("No notes selected")).toBeInTheDocument();
    expect(screen.getByText("Select at least one note for Bun.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock ask" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Use Work category for Ask" }));

    expect(screen.getByText("1 note selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mock ask" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Mock ask" }));

    await waitFor(() => {
      expect(askQuestion).toHaveBeenLastCalledWith(expect.objectContaining({ note_ids: [10] }));
    });

    ask.resolve(askResponse);

    fireEvent.click(screen.getByRole("checkbox", { name: "Use all notes for Ask" }));

    expect(screen.getByText("All notes selected")).toBeInTheDocument();
  });

  test("opens the existing new-note workspace from the sidebar action", async () => {
    render(<App />);

    await expandCategory("Work");

    fireEvent.click(screen.getByRole("button", { name: /Work note/ }));
    expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();

    fireEvent.click(getSidebarNewNoteButton());

    expect(screen.getByText("Workspace mode: new")).toBeInTheDocument();
  });

  test("shows compact note rows while browsing", async () => {
    render(<App />);

    await expandCategory("Work");

    const noteRow = screen.getByRole("button", { name: /Work note/ });

    expect(noteRow).toHaveTextContent("Work note");
    expect(noteRow).toHaveTextContent("Jul 3");
    expect(noteRow).not.toHaveTextContent("A note about work.");
    expect(noteRow).not.toHaveTextContent("work");
    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).toBeInTheDocument();

    fireEvent.click(noteRow);

    expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();
    expect(noteRow).toHaveAttribute("aria-selected", "true");
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

  test("keeps search tab presentation while search text is typed but not submitted", async () => {
    vi.mocked(searchNotes).mockResolvedValueOnce([
      {
        ...notes[0],
        match_type: "fuzzy",
        matched_snippet: "Work note",
        score: 0.82,
      },
    ]);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });

    expect(searchbox).toHaveValue("work");
    await waitFor(() => {
      expect(searchNotes).toHaveBeenCalledWith("work", { semantic: false });
    });
    expect(screen.queryByRole("tree", { name: "Browse notes" })).not.toBeInTheDocument();
    expect(screen.getByText("Results for “work”", { selector: "span" })).toBeInTheDocument();
  });

  test("pressing enter runs full search after live local search", async () => {
    vi.mocked(searchNotes)
      .mockResolvedValueOnce([
        {
          ...notes[0],
          match_type: "fuzzy",
          matched_snippet: "Work note",
          score: 0.82,
        },
      ])
      .mockResolvedValueOnce([
        {
          ...notes[0],
          match_type: "hybrid",
          matched_snippet: "Matched work detail",
          score: 1.9,
        },
      ]);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    });

    openSearchTab();
    const searchbox = screen.getByRole("searchbox", { name: "Search notes" });
    fireEvent.change(searchbox, { target: { value: "work" } });

    await waitFor(() => {
      expect(searchNotes).toHaveBeenCalledWith("work", { semantic: false });
    });

    fireEvent.submit(screen.getByRole("search"));

    await waitFor(() => {
      expect(searchNotes).toHaveBeenLastCalledWith("work");
    });
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
    expect(screen.getByText("Bun is searching…", { selector: "span" })).toBeInTheDocument();

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
    expect(screen.getByText("1 match")).toBeInTheDocument();

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

    expect(screen.getByText("No notes selected")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Use Work note for Ask" })).not.toBeChecked();
  });

  test("moves a note to another category by dragging it onto a category folder", async () => {
    vi.mocked(updateNote).mockResolvedValueOnce({
      ...notes[0],
      category: categories[1],
      updated_at: "2026-07-05T00:00:00Z",
    });

    render(<App />);

    await expandCategory("Work");
    const workNote = screen.getByRole("button", { name: /Work note/ });
    const personalCategory = screen.getByRole("button", { name: "Personal" });

    fireEvent.dragStart(workNote);
    fireEvent.dragOver(personalCategory);
    fireEvent.drop(personalCategory);

    await waitFor(() => {
      expect(updateNote).toHaveBeenCalledWith(10, { category_id: 2 });
    });
    expect(personalCategory).toHaveAttribute("aria-expanded", "true");
  });

  test("moves a note to Uncategorized by dragging it onto the Uncategorized folder", async () => {
    vi.mocked(updateNote).mockResolvedValueOnce({
      ...notes[1],
      category: null,
      needs_ai_organization: false,
      updated_at: "2026-07-05T00:00:00Z",
    });

    render(<App />);

    await expandCategory("Personal");
    const personalNote = screen.getByRole("button", { name: /Personal note/ });
    const uncategorizedFolder = screen.getByRole("button", { name: "Uncategorized" });

    fireEvent.dragStart(personalNote);
    fireEvent.dragOver(uncategorizedFolder);
    fireEvent.drop(uncategorizedFolder);

    await waitFor(() => {
      expect(updateNote).toHaveBeenCalledWith(11, { category_id: null });
    });
    expect(uncategorizedFolder).toHaveAttribute("aria-expanded", "true");
  });

  test("cancels drag moves when unsaved selected-note edits are not discarded", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);

    render(<App />);

    await expandCategory("Work");
    const workNote = screen.getByRole("button", { name: /Work note/ });
    fireEvent.click(workNote);
    await waitFor(() => {
      expect(screen.getByText("Loaded note: Work note")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Mock edit" }));
    expect(screen.getByText("Workspace mode: edit-selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mock dirty" }));

    fireEvent.dragStart(workNote);
    fireEvent.drop(screen.getByRole("button", { name: "Personal" }));

    expect(confirm).toHaveBeenCalledWith("Discard unsaved note changes?");
    expect(updateNote).not.toHaveBeenCalled();
    confirm.mockRestore();
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
    expect(screen.getByText("No matching notes", { selector: "span" })).toBeInTheDocument();
    expect(screen.getAllByText("No matching notes")).toHaveLength(2);
    expect(screen.getByText("Try another phrase or browse your notebook index.")).toBeInTheDocument();
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
    expect(screen.getByText("Search hit a snag")).toBeInTheDocument();
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
