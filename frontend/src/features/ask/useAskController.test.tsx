import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  askQuestion,
  createChatThread,
  deleteChatThread,
  getChatThreadMessages,
  listChatThreads,
  updateChatThread,
} from "../../api";
import type { AskResponse, ChatThread, StoredChatMessage } from "../../types";
import { useAskController } from "./useAskController";

vi.mock("../../api", () => ({
  askQuestion: vi.fn(),
  createChatThread: vi.fn(),
  deleteChatThread: vi.fn(),
  getChatThreadMessages: vi.fn(),
  listChatThreads: vi.fn(),
  updateChatThread: vi.fn(),
}));

const generalThread: ChatThread = {
  id: 1,
  title: "General",
  scope: { mode: "all" },
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-01T00:00:00Z",
};

const focusedThread: ChatThread = {
  id: 2,
  title: "Focused",
  scope: { mode: "custom", note_ids: [10] },
  created_at: "2026-07-02T00:00:00Z",
  updated_at: "2026-07-02T00:00:00Z",
};

const restoredMessages: StoredChatMessage[] = [
  {
    id: "chat:1",
    role: "user",
    content: "Restored question",
    created_at: "2026-07-01T00:00:00Z",
  },
  {
    id: "chat:2",
    role: "assistant",
    content: "Restored answer.",
    created_at: "2026-07-01T00:00:01Z",
    status: "completed",
    evidence_summary: { source_count: 0, snippet_count: 0, match_types: [] },
    sources: [],
  },
];

const askResponse: AskResponse = {
  answer: "Focused answer.",
  status: "answered",
  evidence_summary: { source_count: 0, snippet_count: 0, match_types: [] },
  sources: [],
  memory_updates: 0,
};

function renderAskController(onSourceSelect = vi.fn<(noteId: number) => void>()) {
  return renderHook(() =>
    useAskController({
      availableNoteCount: 2,
      availableNoteIds: [10, 11],
      onSourceSelect,
    }),
  );
}

beforeEach(() => {
  vi.mocked(listChatThreads).mockResolvedValue([generalThread]);
  vi.mocked(getChatThreadMessages).mockResolvedValue([]);
  vi.mocked(createChatThread).mockResolvedValue({
    ...generalThread,
    id: 3,
    title: "Untitled chat",
  });
  vi.mocked(updateChatThread).mockImplementation((threadId, body) =>
    Promise.resolve({
      ...(threadId === focusedThread.id ? focusedThread : generalThread),
      ...(body.title ? { title: body.title } : {}),
      ...(body.scope ? { scope: body.scope } : {}),
    }),
  );
  vi.mocked(deleteChatThread).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useAskController", () => {
  test("loads the latest thread, restores messages, and exposes citation navigation", async () => {
    const onSourceSelect = vi.fn<(noteId: number) => void>();
    vi.mocked(listChatThreads).mockResolvedValue([generalThread, focusedThread]);
    vi.mocked(getChatThreadMessages).mockResolvedValue(restoredMessages);

    const { result } = renderAskController(onSourceSelect);

    await waitFor(() => expect(result.current.activeThreadId).toBe(1));

    expect(result.current.threads).toEqual([generalThread, focusedThread]);
    expect(result.current.messages).toEqual([
      { id: "chat:1", role: "user", content: "Restored question" },
      {
        id: "chat:2",
        role: "assistant",
        content: "Restored answer.",
        status: "answered",
        evidenceSummary: { source_count: 0, snippet_count: 0, match_types: [] },
        sources: [],
      },
    ]);
    expect(result.current.askRef.current).toBeNull();

    act(() => result.current.onSourceSelect(11));
    expect(onSourceSelect).toHaveBeenCalledWith(11);
  });

  test("switches threads and submits with the active thread scope and recent history", async () => {
    vi.mocked(listChatThreads).mockResolvedValue([generalThread, focusedThread]);
    vi.mocked(getChatThreadMessages).mockImplementation((threadId) =>
      Promise.resolve(
        threadId === generalThread.id
          ? restoredMessages
          : [
              {
                id: "chat:3",
                role: "user",
                content: "Focused question",
                created_at: "2026-07-02T00:00:00Z",
              },
            ],
      ),
    );
    vi.mocked(askQuestion).mockResolvedValue(askResponse);

    const { result } = renderAskController();
    await waitFor(() => expect(result.current.activeThreadId).toBe(1));

    await act(() => result.current.onThreadChange(2));
    expect(result.current.messages).toEqual([
      { id: "chat:3", role: "user", content: "Focused question" },
    ]);
    expect(result.current.scopeLabel).toBe("1 note selected");

    await act(() => result.current.onSubmit(" What did I save? "));

    expect(askQuestion).toHaveBeenCalledWith({
      thread_id: 2,
      question: "What did I save?",
      history: [{ role: "user", content: "Focused question" }],
      note_ids: [10],
    });
    expect(result.current.messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "Focused answer.",
    });
    expect(result.current.pendingMessageId).toBeNull();
  });

  test("owns note scope state, persists changes, and normalizes unavailable notes", async () => {
    vi.mocked(listChatThreads).mockResolvedValue([{ ...focusedThread, scope: { mode: "custom", note_ids: [10, 99] } }]);

    const { result, rerender } = renderHook(
      ({ availableNoteIds }) =>
        useAskController({
          availableNoteCount: availableNoteIds.length,
          availableNoteIds,
          onSourceSelect: vi.fn(),
        }),
      { initialProps: { availableNoteIds: [10, 11] } },
    );

    await waitFor(() => expect(result.current.activeThreadId).toBe(2));
    await waitFor(() => expect(result.current.noteScope).toEqual({ mode: "custom", noteIds: [10] }));
    expect(result.current.scopeSummary).toBe("1 note selected");
    expect(result.current.isNoteSelected(10)).toBe(true);
    expect(result.current.isNoteSelected(11)).toBe(false);

    act(() => result.current.setSourceNotesSelected([11], true));
    await waitFor(() => {
      expect(updateChatThread).toHaveBeenCalledWith(2, { scope: { mode: "all" } });
    });
    expect(result.current.noteScope).toEqual({ mode: "all" });

    act(() => result.current.toggleAllNotes());
    expect(result.current.isSubmitDisabled).toBe(true);
    expect(result.current.submitDisabledMessage).toBe("Select at least one note for Bun.");

    act(() => result.current.toggleNoteScope(11));
    expect(result.current.noteScope).toEqual({ mode: "custom", noteIds: [11] });

    rerender({ availableNoteIds: [10] });
    await waitFor(() => expect(result.current.noteScope).toEqual({ mode: "custom", noteIds: [] }));
  });

  test("creates, renames, and deletes threads while preserving an available active thread", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.mocked(listChatThreads).mockResolvedValue([generalThread]);
    const newThread = { ...generalThread, id: 3, title: "Untitled chat" };
    vi.mocked(createChatThread).mockResolvedValue(newThread);
    vi.mocked(updateChatThread).mockResolvedValue({ ...newThread, title: "Renamed chat" });

    const { result } = renderAskController();
    await waitFor(() => expect(result.current.activeThreadId).toBe(1));

    await act(() => result.current.onNewThread());
    expect(result.current.activeThreadId).toBe(3);
    expect(result.current.threads).toEqual([newThread, generalThread]);

    await act(() => result.current.onRenameThread(3, "Renamed chat"));
    expect(updateChatThread).toHaveBeenCalledWith(3, { title: "Renamed chat" });
    expect(result.current.threads[0].title).toBe("Renamed chat");

    await act(() => result.current.onDeleteThread(3));
    expect(window.confirm).toHaveBeenCalledWith('Delete "Renamed chat"?');
    expect(deleteChatThread).toHaveBeenCalledWith(3);
    expect(result.current.activeThreadId).toBe(1);
  });
});
