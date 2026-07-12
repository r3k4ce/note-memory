import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { AskChat } from "./AskChat";
import type { ChatMessage } from "../../types";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

function renderAskChat({
  activeThreadId = 1,
  isSubmitDisabled = false,
  messages = [],
  onSourceSelect = vi.fn(),
  pendingMessageId = null,
  submitDisabledMessage,
  onDeleteThread = vi.fn(),
  onNewThread = vi.fn(),
  onRenameThread = vi.fn(),
  onThreadChange = vi.fn(),
  threads = [
    {
      id: 1,
      title: "Launch notes",
      scope: { mode: "all" as const },
      created_at: "2026-07-01T00:00:00Z",
      updated_at: "2026-07-01T00:00:00Z",
    },
    {
      id: 2,
      title: "Follow-up",
      scope: { mode: "custom" as const, note_ids: [7] },
      created_at: "2026-07-02T00:00:00Z",
      updated_at: "2026-07-02T00:00:00Z",
    },
  ],
}: {
  activeThreadId?: number | null;
  isSubmitDisabled?: boolean;
  messages?: ChatMessage[];
  onSourceSelect?: (noteId: number) => void;
  pendingMessageId?: string | null;
  submitDisabledMessage?: string;
  onDeleteThread?: (threadId: number) => void;
  onNewThread?: () => void;
  onRenameThread?: (threadId: number, newTitle: string) => void;
  onThreadChange?: (threadId: number) => void;
  threads?: Parameters<typeof AskChat>[0]["threads"];
} = {}) {
  const onSubmit = vi.fn();

  render(
    <AskChat
      askRef={createRef<HTMLTextAreaElement>()}
      isSubmitDisabled={isSubmitDisabled}
      messages={messages}
      activeThreadId={activeThreadId}
      threads={threads}
      onSourceSelect={onSourceSelect}
      onDeleteThread={onDeleteThread}
      onNewThread={onNewThread}
      onRenameThread={onRenameThread}
      onThreadChange={onThreadChange}
      onSubmit={onSubmit}
      pendingMessageId={pendingMessageId}
      scopeLabel="All notes"
      submitDisabledMessage={submitDisabledMessage}
    />,
  );

  return { onDeleteThread, onNewThread, onRenameThread, onSourceSelect, onSubmit, onThreadChange };
}

describe("AskChat Ask Bun panel", () => {
  test("uses Ask Bun heading and copy while keeping controlled submit behavior", () => {
    const { onSubmit } = renderAskChat();

    const heading = screen.getByRole("heading", { name: "Ask Bun" });
    expect(heading).toBeInTheDocument();
    expect(heading.closest("header")).not.toHaveClass("border-b", "border-border");
    expect(screen.getByText("Sniffing through All notes")).toBeInTheDocument();
    expect(
      screen.getByText("Ask Bun to sniff out decisions, trace sources, or spot gaps in the selected notes."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What did Bun tuck away today?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find decisions with sources" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What still needs follow-up?" })).toBeInTheDocument();

    const textarea = screen.getByLabelText("Ask a question about saved notes");
    expect(screen.getByPlaceholderText("Ask Bun about your notes…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
    expect(screen.queryByText("Enter to send · Shift+Enter for a new line")).not.toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "What did I save about React?" } });
    expect(textarea).toHaveValue("What did I save about React?");
    expect(screen.getByRole("button", { name: "Send question" })).toBeEnabled();

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSubmit).toHaveBeenCalledWith("What did I save about React?");
    expect(textarea).toHaveValue("");
  });

  test("keeps pending disable state and opens source cards", () => {
    const { onSourceSelect } = renderAskChat({
      messages: [
        {
          id: "assistant:1",
          role: "assistant",
          content: "Use controlled textarea state.",
          status: "answered",
          sources: [
            {
              note_id: 7,
              title: "React textarea notes",
              date_added: "2026-07-04T01:02:03Z",
              snippets: [
                {
                  text: "Use controlled textarea state for saved draft edits.",
                  match_type: "semantic",
                  chunk_index: 0,
                },
              ],
            },
          ],
        },
      ],
      pendingMessageId: "assistant:pending",
    });

    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
    expect(screen.getByLabelText("Ask a question about saved notes")).toBeDisabled();
    expect(screen.getByText("I'm reading your notes…")).toBeInTheDocument();
    expect(screen.getByText("Read 1 card")).toBeInTheDocument();
    expect(screen.getByText("Jul 4, 2026")).toBeInTheDocument();
    expect(screen.getByText("Use controlled textarea state for saved draft edits.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open cited note 1: React textarea notes" }));

    expect(onSourceSelect).toHaveBeenCalledWith(7);
  });

  test("shows staged Bun pending copy", () => {
    renderAskChat({
      messages: [
        {
          id: "assistant:pending",
          role: "assistant",
          content: "I'm sniffing through the right notes…\nI'm checking the evidence…\nI'm drafting a grounded answer…",
          sources: [],
        },
      ],
      pendingMessageId: "assistant:pending",
    });

    expect(screen.getByText(/I'm sniffing through the right notes/)).toBeInTheDocument();
    expect(screen.getByText(/I'm checking the evidence/)).toBeInTheDocument();
    expect(screen.getByText(/I'm drafting a grounded answer/)).toBeInTheDocument();
  });

  test("shows memory update and icon-only chat controls in the header", () => {
    renderAskChat({
      messages: [
        {
          id: "assistant:1",
          role: "assistant",
          content: "Direct answer.",
          status: "answered",
          sources: [],
          memoryUpdates: 1,
        },
      ],
    });

    expect(screen.getByText("Memory updated")).toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Open chats" });
    expect(trigger).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "New chat" })).toHaveTextContent("");
    expect(screen.queryByText("Launch notes")).not.toBeInTheDocument();
    expect(screen.getByText("Sniffing through All notes")).toHaveClass("max-[320px]:hidden");
  });

  test("keeps the chat trigger icon-only while no active thread has loaded", () => {
    renderAskChat({ activeThreadId: null, threads: [] });
    expect(screen.getByRole("button", { name: "Open chats" })).toHaveTextContent("");
  });

  test("starts a new chat from the header without opening the menu", () => {
    const { onNewThread } = renderAskChat();

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(onNewThread).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "Chats" })).not.toBeInTheDocument();
  });

  test("starts a new chat from the header and closes an open menu", () => {
    const { onNewThread } = renderAskChat();
    fireEvent.click(screen.getByRole("button", { name: "Open chats" }));

    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(onNewThread).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "Chats" })).not.toBeInTheDocument();
  });

  test("opens the menu and keeps it open after rename and delete", () => {
    const { onDeleteThread, onNewThread, onRenameThread, onThreadChange } = renderAskChat();

    fireEvent.click(screen.getByRole("button", { name: "Open chats" }));

    const menu = screen.getByRole("menu", { name: "Chats" });
    expect(menu).toHaveClass("w-64");
    expect(within(menu).getByRole("list")).toHaveClass("max-h-80", "overflow-y-auto");

    fireEvent.click(screen.getByRole("button", { name: "Rename Launch notes" }));
    const input = screen.getByDisplayValue("Launch notes");
    fireEvent.change(input, { target: { value: "Renamed thread" } });
    fireEvent.click(screen.getByRole("button", { name: "Save title" }));
    expect(onRenameThread).toHaveBeenCalledWith(1, "Renamed thread");
    expect(screen.getByRole("menu", { name: "Chats" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Follow-up" }));
    expect(onDeleteThread).toHaveBeenCalledWith(2);
    expect(screen.getByRole("menu", { name: "Chats" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Follow-up"));
    expect(onThreadChange).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("menu", { name: "Chats" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open chats" }));
    fireEvent.click(screen.getByText("New Chat"));
    expect(onNewThread).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu", { name: "Chats" })).not.toBeInTheDocument();
  });

  test("dismisses on outside press and Escape and restores trigger focus", () => {
    renderAskChat();
    const trigger = screen.getByRole("button", { name: "Open chats" });

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "Chats" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Chats" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test("dismisses when the trigger is pressed again", () => {
    renderAskChat();
    const trigger = screen.getByRole("button", { name: "Open chats" });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Chats" })).toBeInTheDocument();

    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu", { name: "Chats" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  test("highlights active thread in the menu", () => {
    renderAskChat();

    fireEvent.click(screen.getByRole("button", { name: "Open chats" }));

    const activeRow = within(screen.getByRole("menu", { name: "Chats" }))
      .getByRole("menuitem", { name: "Launch notes" })
      .closest("[class*='bg-accent-muted']");
    expect(activeRow).toBeInTheDocument();
  });

  test("disables both chat controls while an Ask request is pending", () => {
    renderAskChat({ pendingMessageId: "assistant:pending" });

    expect(screen.getByRole("button", { name: "Open chats" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New chat" })).toBeDisabled();
  });

  test("allows inline rename with Enter key", () => {
    const { onRenameThread } = renderAskChat();

    fireEvent.click(screen.getByRole("button", { name: "Open chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename Follow-up" }));

    const input = screen.getByDisplayValue("Follow-up");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onRenameThread).toHaveBeenCalledWith(2, "New title");
  });

  test("cancels inline rename with Escape key", () => {
    const { onRenameThread } = renderAskChat();

    fireEvent.click(screen.getByRole("button", { name: "Open chats" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename Follow-up" }));

    const input = screen.getByDisplayValue("Follow-up");
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onRenameThread).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("New title")).not.toBeInTheDocument();
  });

  test("shows friendly no-evidence state", () => {
    renderAskChat({
      messages: [
        {
          id: "assistant:1",
          role: "assistant",
          content: "I do not have this in the saved notes.",
          status: "no_evidence",
          sources: [],
        },
      ],
    });

    expect(
      screen.getByText(
        "I couldn't sniff that out in this notebook yet. Try selecting a note or using a phrase you remember.",
      ),
    ).toBeInTheDocument();
  });

  test("renders completed answers as GitHub-flavored Markdown", () => {
    renderAskChat({
      messages: [
        {
          id: "assistant:1",
          role: "assistant",
          content:
            "## Summary\n\nThis is **important** and _grounded_.\n\n- First point\n- Second point\n\n`inline code`\n\n```ts\nconst answer = 42;\n```\n\n- [x] Reviewed\n\n| Note | Status |\n| --- | --- |\n| Ask Bun | Ready |",
          status: "answered",
          sources: [],
        },
      ],
    });

    expect(screen.getByRole("heading", { name: "Summary", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("important").tagName).toBe("STRONG");
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getByText("inline code").tagName).toBe("CODE");
    expect(screen.getByText("const answer = 42;").closest("pre")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  test("opens valid inline citations from formatted answers", () => {
    const { onSourceSelect } = renderAskChat({
      messages: [
        {
          id: "assistant:1",
          role: "assistant",
          content: "Bun found this in the React card. [1]",
          status: "answered",
          sources: [
            {
              note_id: 7,
              title: "React textarea notes",
              date_added: "2026-07-04T01:02:03Z",
              snippets: [],
            },
          ],
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Open citation 1: React textarea notes" }));

    expect(onSourceSelect).toHaveBeenCalledWith(7);
  });

  test("leaves invalid and code citations as literal text", () => {
    renderAskChat({
      messages: [
        {
          id: "assistant:1",
          role: "assistant",
          content: "Unknown [2].\n\n`Code [1]`",
          status: "answered",
          sources: [
            {
              note_id: 7,
              title: "React textarea notes",
              date_added: "2026-07-04T01:02:03Z",
              snippets: [],
            },
          ],
        },
      ],
    });

    expect(screen.getByText("Unknown [2].")).toBeInTheDocument();
    expect(screen.getByText("Code [1]").tagName).toBe("CODE");
    expect(screen.queryByRole("button", { name: /Open citation/ })).not.toBeInTheDocument();
  });

  test("keeps custom disabled message visible when Ask has no selected notes", () => {
    renderAskChat({
      isSubmitDisabled: true,
      submitDisabledMessage: "Select at least one note for Bun.",
    });

    expect(screen.getByText("Select at least one note for Bun.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
  });

  test("shows first-note helper when there are no notes", () => {
    const onSubmit = vi.fn();

    render(
      <AskChat
        askRef={createRef<HTMLTextAreaElement>()}
        activeThreadId={null}
        hasNotes={false}
        messages={[]}
        onSourceSelect={vi.fn()}
        onSubmit={onSubmit}
        pendingMessageId={null}
        scopeLabel="All notes"
        threads={[]}
      />,
    );

    expect(screen.getByText("Save your first note, then Bun can start sniffing through it.")).toBeInTheDocument();
  });
});
