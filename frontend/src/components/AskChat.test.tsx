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
}: {
  isSubmitDisabled?: boolean;
  messages?: ChatMessage[];
  onSourceSelect?: (noteId: number) => void;
  pendingMessageId?: string | null;
  submitDisabledMessage?: string;
} = {}) {
  const onSubmit = vi.fn();

  render(
    <AskChat
      askRef={createRef<HTMLTextAreaElement>()}
      isSubmitDisabled={isSubmitDisabled}
      messages={messages}
      onSourceSelect={onSourceSelect}
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
    expect(screen.getByText("Searching · All notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What did I save today?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find decisions with sources" })).toBeInTheDocument();

    const textarea = screen.getByLabelText("Ask a question about saved notes");
    expect(screen.getByPlaceholderText("Ask about your notes...")).toBeInTheDocument();
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
    expect(screen.getByText("Bun is reading your notes…")).toBeInTheDocument();
    expect(screen.getByText("Bun read 1 card")).toBeInTheDocument();
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
          content: "Bun is finding notes...\nBun is checking snippets...\nBun is writing...",
          sources: [],
        },
      ],
      pendingMessageId: "assistant:pending",
    });

    expect(screen.getByText(/Bun is finding notes/)).toBeInTheDocument();
    expect(screen.getByText(/Bun is checking snippets/)).toBeInTheDocument();
    expect(screen.getByText(/Bun is writing/)).toBeInTheDocument();
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

    expect(screen.getByText("Bun couldn't find that in this notebook yet.")).toBeInTheDocument();
  });

  test("opens notes from citation chips", () => {
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

  test("keeps custom disabled message visible when Ask has no selected notes", () => {
    renderAskChat({
      isSubmitDisabled: true,
      submitDisabledMessage: "Select at least one note for Ask",
    });

    expect(screen.getByText("Select at least one note for Ask")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send question" })).toBeDisabled();
  });
});
