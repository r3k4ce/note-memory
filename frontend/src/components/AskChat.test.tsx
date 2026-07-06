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
    expect(screen.getByText(/Ask Bun about your notes/)).toBeInTheDocument();

    const textarea = screen.getByLabelText("Ask a question about saved notes");
    expect(screen.getByPlaceholderText("Ask about your notes...")).toBeInTheDocument();

    fireEvent.change(textarea, { target: { value: "What did I save about React?" } });
    expect(textarea).toHaveValue("What did I save about React?");

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
          sources: [
            {
              note_id: 7,
              title: "React textarea notes",
              date_added: "2026-07-04T01:02:03Z",
            },
          ],
        },
      ],
      pendingMessageId: "assistant:pending",
    });

    expect(screen.getByRole("button", { name: /Reading/i })).toBeDisabled();
    expect(screen.getByLabelText("Ask a question about saved notes")).toBeDisabled();
    expect(screen.getByText("Sources · 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open cited note: React textarea notes" }));

    expect(onSourceSelect).toHaveBeenCalledWith(7);
  });

  test("keeps custom disabled message visible when Ask has no selected notes", () => {
    renderAskChat({
      isSubmitDisabled: true,
      submitDisabledMessage: "Select at least one note for Ask",
    });

    expect(screen.getByText("Select at least one note for Ask")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});
