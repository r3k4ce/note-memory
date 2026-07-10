import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { AskChat } from "./AskChat";
import type { ChatMessage } from "../types";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

function renderAskChat({
  isSubmitDisabled = false,
  messages = [],
  onSourceSelect = vi.fn(),
  pendingMessageId = null,
  submitDisabledMessage,
  onClearChat = vi.fn(),
}: {
  isSubmitDisabled?: boolean;
  messages?: ChatMessage[];
  onSourceSelect?: (noteId: number) => void;
  pendingMessageId?: string | null;
  submitDisabledMessage?: string;
  onClearChat?: () => void;
} = {}) {
  const onSubmit = vi.fn();

  render(
    <AskChat
      askRef={createRef<HTMLTextAreaElement>()}
      isSubmitDisabled={isSubmitDisabled}
      messages={messages}
      onSourceSelect={onSourceSelect}
      onClearChat={onClearChat}
      onSubmit={onSubmit}
      pendingMessageId={pendingMessageId}
      scopeLabel="All notes"
      submitDisabledMessage={submitDisabledMessage}
    />,
  );

  return { onSourceSelect, onSubmit };
}

describe("AskChat Ask Bun panel", () => {
  test("uses Ask Bun heading and copy while keeping controlled submit behavior", () => {
    const { onSubmit } = renderAskChat();

    expect(screen.getByRole("heading", { name: "Ask Bun" })).toBeInTheDocument();
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

  test("shows a quiet memory update and keeps chat clearing separate", () => {
    const onClearChat = vi.fn();
    renderAskChat({
      onClearChat,
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
    fireEvent.click(screen.getByRole("button", { name: "Clear chat" }));
    expect(onClearChat).toHaveBeenCalledTimes(1);
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
        hasNotes={false}
        messages={[]}
        onSourceSelect={vi.fn()}
        onSubmit={onSubmit}
        pendingMessageId={null}
        scopeLabel="All notes"
      />,
    );

    expect(screen.getByText("Save your first note, then Bun can start sniffing through it.")).toBeInTheDocument();
  });
});
