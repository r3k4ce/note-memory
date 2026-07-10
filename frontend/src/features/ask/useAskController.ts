import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
  askQuestion,
  createChatThread,
  deleteChatThread,
  getChatThreadMessages,
  listChatThreads,
  updateChatThread,
} from "../../api";
import {
  areAskNoteScopesEqual,
  clearAskNotes,
  DEFAULT_ASK_NOTE_SCOPE,
  formatAskNoteScopeSelectedCount,
  getAskNoteScopeSelectedCount,
  isNoteSelectedForAsk,
  normalizeAskNoteScope,
  selectAllAskNotes,
  setAskNoteScopeSelected,
  toggleAskNoteScope,
} from "../../askScope";
import type {
  AskHistoryMessage,
  AskNoteScope,
  ChatMessage,
  ChatThread,
  StoredAskNoteScope,
  StoredChatMessage,
} from "../../types";

const ASK_HISTORY_MESSAGE_LIMIT = 6;

type AskHistorySourceMessage = Extract<ChatMessage, { role: "user" | "assistant" }>;

export type UseAskControllerOptions = {
  availableNoteCount: number;
  availableNoteIds: number[];
  onSourceSelect: (noteId: number) => void;
};

export type AskController = {
  activeThreadId: number | null;
  askRef: RefObject<HTMLTextAreaElement | null>;
  isNoteSelected: (noteId: number) => boolean;
  isSubmitDisabled: boolean;
  messages: ChatMessage[];
  noteScope: AskNoteScope;
  onDeleteThread: (threadId: number) => Promise<void>;
  onNewThread: () => Promise<void>;
  onRenameThread: (threadId: number, newTitle: string) => Promise<void>;
  onSourceSelect: (noteId: number) => void;
  onSubmit: (question: string) => Promise<void>;
  onThreadChange: (threadId: number) => Promise<void>;
  pendingMessageId: string | null;
  scopeLabel: string;
  scopeSummary: string;
  setSourceNotesSelected: (noteIds: number[], selected: boolean) => void;
  submitDisabledMessage: string | undefined;
  threads: ChatThread[];
  toggleAllNotes: () => void;
  toggleNoteScope: (noteId: number) => void;
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function buildRecentAskHistory(
  messages: ChatMessage[],
  pendingMessageId: string | null,
): AskHistoryMessage[] {
  return messages
    .filter(
      (message): message is AskHistorySourceMessage =>
        (message.role === "user" || message.role === "assistant") &&
        message.id !== pendingMessageId &&
        message.content.trim().length > 0,
    )
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .slice(-ASK_HISTORY_MESSAGE_LIMIT);
}

function storedScopeToAskNoteScope(thread: ChatThread): AskNoteScope {
  if (thread.scope.mode === "all") {
    return DEFAULT_ASK_NOTE_SCOPE;
  }

  return { mode: "custom", noteIds: thread.scope.note_ids };
}

function askNoteScopeToStoredScope(scope: AskNoteScope): StoredAskNoteScope {
  return scope.mode === "all"
    ? { mode: "all" }
    : { mode: "custom", note_ids: scope.noteIds };
}

function storedMessageToChatMessage(message: StoredChatMessage): ChatMessage {
  if (message.role === "user") {
    return {
      id: message.id,
      role: "user",
      content: message.content,
    };
  }

  return {
    id: message.id,
    role: "assistant",
    content: message.content,
    status: message.status,
    evidenceSummary: message.evidence_summary,
    sources: message.sources ?? [],
  };
}

function formatAskChatScopeLabel(scope: AskNoteScope, totalNotes: number): string {
  if (scope.mode === "all") {
    return "All notes";
  }

  const selectedCount = getAskNoteScopeSelectedCount(scope, totalNotes);
  if (selectedCount === 0) {
    return "No notes selected";
  }

  return selectedCount === 1 ? "1 note selected" : `${selectedCount} notes selected`;
}

export function useAskController({
  availableNoteCount,
  availableNoteIds,
  onSourceSelect,
}: UseAskControllerOptions): AskController {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null);
  const [noteScope, setNoteScope] = useState<AskNoteScope>(DEFAULT_ASK_NOTE_SCOPE);
  const requestIdRef = useRef(0);
  const messageIdRef = useRef(0);
  const pendingMessageIdRef = useRef<string | null>(null);
  const threadRequestIdRef = useRef(0);
  const askRef = useRef<HTMLTextAreaElement>(null);

  const loadThread = useCallback(async (thread: ChatThread, nextThreads: ChatThread[]) => {
    const requestId = threadRequestIdRef.current + 1;
    threadRequestIdRef.current = requestId;
    const storedMessages = await getChatThreadMessages(thread.id);
    if (threadRequestIdRef.current !== requestId) {
      return;
    }

    setThreads(nextThreads);
    setActiveThreadId(thread.id);
    setMessages(storedMessages.map(storedMessageToChatMessage));
    setNoteScope(storedScopeToAskNoteScope(thread));
  }, []);

  const loadLatestThread = useCallback(async () => {
    const loadedThreads = await listChatThreads();
    const latestThread = loadedThreads[0] ?? (await createChatThread());
    await loadThread(latestThread, loadedThreads.length > 0 ? loadedThreads : [latestThread]);
  }, [loadThread]);

  useEffect(() => {
    void loadLatestThread().catch(() => undefined);
  }, [loadLatestThread]);

  useEffect(() => {
    const normalizedScope = normalizeAskNoteScope(noteScope, availableNoteIds);
    if (!areAskNoteScopesEqual(noteScope, normalizedScope)) {
      setNoteScope(normalizedScope);
    }
  }, [availableNoteIds, noteScope]);

  const persistScope = useCallback((scope: AskNoteScope) => {
    if (activeThreadId !== null) {
      void updateChatThread(activeThreadId, { scope: askNoteScopeToStoredScope(scope) }).catch(
        () => undefined,
      );
    }
  }, [activeThreadId]);

  const toggleNoteScope = useCallback((noteId: number) => {
    setNoteScope((currentScope) => {
      const nextScope = toggleAskNoteScope(currentScope, noteId, availableNoteIds);
      persistScope(nextScope);
      return nextScope;
    });
  }, [availableNoteIds, persistScope]);

  const toggleAllNotes = useCallback(() => {
    setNoteScope((currentScope) => {
      const nextScope = currentScope.mode === "all" ? clearAskNotes() : selectAllAskNotes();
      persistScope(nextScope);
      return nextScope;
    });
  }, [persistScope]);

  const setSourceNotesSelected = useCallback((noteIds: number[], selected: boolean) => {
    setNoteScope((currentScope) => {
      const nextScope = setAskNoteScopeSelected(
        currentScope,
        noteIds,
        selected,
        availableNoteIds,
      );
      persistScope(nextScope);
      return nextScope;
    });
  }, [availableNoteIds, persistScope]);

  const createMessageId = useCallback(() => {
    messageIdRef.current += 1;
    return `ask:${messageIdRef.current}`;
  }, []);

  const onSubmit = useCallback(async (question: string) => {
    const trimmedQuestion = question.trim();
    if (
      !trimmedQuestion ||
      pendingMessageIdRef.current !== null ||
      (noteScope.mode === "custom" && noteScope.noteIds.length === 0) ||
      activeThreadId === null
    ) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const threadId = activeThreadId;
    const history = buildRecentAskHistory(messages, pendingMessageIdRef.current);
    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: trimmedQuestion,
    };
    const nextPendingMessageId = createMessageId();
    const pendingMessage: ChatMessage = {
      id: nextPendingMessageId,
      role: "assistant",
      content: "I'm sniffing through the right notes…\nI'm checking the evidence…\nI'm drafting a grounded answer…",
      sources: [],
    };

    pendingMessageIdRef.current = nextPendingMessageId;
    setPendingMessageId(nextPendingMessageId);
    setMessages((currentMessages) => [...currentMessages, userMessage, pendingMessage]);

    try {
      const result = await askQuestion({
        thread_id: threadId,
        question: trimmedQuestion,
        history,
        ...(noteScope.mode === "custom" ? { note_ids: noteScope.noteIds } : {}),
      });
      if (
        requestIdRef.current === requestId &&
        pendingMessageIdRef.current === nextPendingMessageId
      ) {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === nextPendingMessageId
              ? {
                  id: nextPendingMessageId,
                  role: "assistant",
                  content: result.answer,
                  status: result.status,
                  evidenceSummary: result.evidence_summary,
                  memoryUpdates: result.memory_updates,
                  sources: result.sources,
                }
              : message,
          ),
        );
        void listChatThreads().then(setThreads).catch(() => undefined);
      }
    } catch (error) {
      if (
        requestIdRef.current === requestId &&
        pendingMessageIdRef.current === nextPendingMessageId
      ) {
        setMessages((currentMessages) =>
          currentMessages.map((message) =>
            message.id === nextPendingMessageId
              ? {
                  id: nextPendingMessageId,
                  role: "error",
                  content: getErrorMessage(error, "Bun couldn't reach your notes."),
                }
              : message,
          ),
        );
      }
    } finally {
      if (
        requestIdRef.current === requestId &&
        pendingMessageIdRef.current === nextPendingMessageId
      ) {
        pendingMessageIdRef.current = null;
        setPendingMessageId(null);
      }
    }
  }, [activeThreadId, createMessageId, messages, noteScope]);

  const onThreadChange = useCallback(async (threadId: number) => {
    if (pendingMessageIdRef.current !== null || threadId === activeThreadId) {
      return;
    }

    try {
      const thread = threads.find((currentThread) => currentThread.id === threadId);
      if (thread) {
        await loadThread(thread, threads);
      }
    } catch {
      return;
    }
  }, [activeThreadId, loadThread, threads]);

  const onNewThread = useCallback(async () => {
    if (pendingMessageIdRef.current !== null) {
      return;
    }

    try {
      const thread = await createChatThread();
      const nextThreads = [
        thread,
        ...threads.filter((currentThread) => currentThread.id !== thread.id),
      ];
      await loadThread(thread, nextThreads);
    } catch {
      return;
    }
  }, [loadThread, threads]);

  const onRenameThread = useCallback(async (threadId: number, newTitle: string) => {
    if (pendingMessageIdRef.current !== null) {
      return;
    }

    try {
      const updatedThread = await updateChatThread(threadId, { title: newTitle });
      setThreads((currentThreads) =>
        currentThreads.map((thread) =>
          thread.id === updatedThread.id ? updatedThread : thread,
        ),
      );
    } catch {
      return;
    }
  }, []);

  const onDeleteThread = useCallback(async (threadId: number) => {
    if (pendingMessageIdRef.current !== null) {
      return;
    }

    const thread = threads.find((currentThread) => currentThread.id === threadId);
    if (!window.confirm(`Delete "${thread?.title ?? "this chat"}"?`)) {
      return;
    }

    try {
      await deleteChatThread(threadId);
      const remainingThreads = threads.filter((currentThread) => currentThread.id !== threadId);
      if (remainingThreads.length > 0) {
        if (threadId === activeThreadId) {
          await loadThread(remainingThreads[0], remainingThreads);
        } else {
          setThreads(remainingThreads);
        }
        return;
      }

      const newThread = await createChatThread();
      await loadThread(newThread, [newThread]);
    } catch {
      return;
    }
  }, [activeThreadId, loadThread, threads]);

  const isSubmitDisabled = noteScope.mode === "custom" && noteScope.noteIds.length === 0;

  return {
    activeThreadId,
    askRef,
    isNoteSelected: (noteId) => isNoteSelectedForAsk(noteScope, noteId),
    isSubmitDisabled,
    messages,
    noteScope,
    onDeleteThread,
    onNewThread,
    onRenameThread,
    onSourceSelect,
    onSubmit,
    onThreadChange,
    pendingMessageId,
    scopeLabel: formatAskChatScopeLabel(noteScope, availableNoteCount),
    scopeSummary: formatAskNoteScopeSelectedCount(noteScope, availableNoteCount),
    setSourceNotesSelected,
    submitDisabledMessage: isSubmitDisabled ? "Select at least one note for Bun." : undefined,
    threads,
    toggleAllNotes,
    toggleNoteScope,
  };
}
