import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  FileText,
  MessageSquare,
  Pencil,
  Plus,
  Quote,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MemoryManager } from "../../components/MemoryManager";
import { formatNoteDate } from "../../dateFormat";
import type { AskSource, ChatMessage, ChatThread } from "../../types";

type AskChatProps = {
  askRef: RefObject<HTMLTextAreaElement | null>;
  hasNotes?: boolean;
  messages: ChatMessage[];
  activeThreadId: number | null;
  threads: ChatThread[];
  onSourceSelect: (noteId: number) => void;
  onDeleteThread?: (threadId: number) => void;
  onNewThread?: () => void;
  onRenameThread?: (threadId: number, newTitle: string) => void;
  onThreadChange?: (threadId: number) => void;
  onSubmit: (question: string) => void;
  pendingMessageId: string | null;
  isSubmitDisabled?: boolean;
  scopeLabel: string;
  submitDisabledMessage?: string;
};

type AssistantBubbleProps = {
  content: string;
  isPending?: boolean;
  onSourceSelect: (noteId: number) => void;
  sources: AskSource[];
  status?: "answered" | "no_evidence";
  memoryUpdates?: number;
};

type MarkdownNode = {
  children?: MarkdownNode[];
  type: string;
  url?: string;
  value?: string;
};

function replaceCitations(node: MarkdownNode, sourceCount: number) {
  if (!node.children || node.type === "code" || node.type === "inlineCode" || node.type === "link") {
    return;
  }

  node.children = node.children.flatMap<MarkdownNode>((child): MarkdownNode | MarkdownNode[] => {
    if (child.type !== "text" || !child.value) {
      replaceCitations(child, sourceCount);
      return child;
    }

    const parts = child.value.split(/(\[\d+\])/g);
    if (parts.length === 1) {
      return child;
    }

    return parts.filter(Boolean).map<MarkdownNode>((part) => {
      const match = /^\[(\d+)\]$/.exec(part);
      const sourceNumber = match ? Number(match[1]) : 0;
      if (sourceNumber < 1 || sourceNumber > sourceCount) {
        return { type: "text", value: part };
      }
      return {
        type: "link",
        url: `#citation-${sourceNumber}`,
        children: [{ type: "text", value: String(sourceNumber) }],
      };
    });
  });
}

function citationRemarkPlugin(sourceCount: number) {
  return () => (tree: MarkdownNode) => replaceCitations(tree, sourceCount);
}

function formatMatchType(matchType: AskSource["snippets"][number]["match_type"]) {
  if (matchType === "selected") {
    return "Selected";
  }
  if (matchType === "semantic") {
    return "Semantic";
  }
  if (matchType === "exact") {
    return "Exact";
  }
  return "Fuzzy";
}

function SourceList({
  onSourceSelect,
  sources,
}: {
  onSourceSelect: (noteId: number) => void;
  sources: AskSource[];
}) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 pt-3" aria-label="Supporting sources">
      <div className="flex items-center gap-1.5">
        <Quote size={11} strokeWidth={2} className="text-text-muted" aria-hidden="true" />
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
          Read {sources.length} {sources.length === 1 ? "card" : "cards"}
        </p>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {sources.map((source, index) => (
          <div
            className="surface-card bg-bg transition-[background-color,border-color,box-shadow] hover:border-border-strong hover:bg-surface hover:shadow-soft"
            key={source.note_id}
          >
            <button
              aria-label={`Open cited note ${index + 1}: ${source.title}`}
              className="group flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-1"
              onClick={() => onSourceSelect(source.note_id)}
              type="button"
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-muted text-[11px] font-semibold tabular-nums text-accent">
                {index + 1}
              </span>
              <FileText size={12} strokeWidth={2} className="shrink-0 text-text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-primary">{source.title}</span>
              <time className="shrink-0 text-xs tabular-nums text-text-muted" dateTime={source.date_added}>
                {formatNoteDate(source.date_added)}
              </time>
              <ArrowUpRight size={12} strokeWidth={2} className="shrink-0 text-text-muted transition-transform group-hover:translate-x-px group-hover:-translate-y-px" aria-hidden="true" />
            </button>
            {source.snippets.length > 0 ? (
              <div className="flex flex-col gap-1 border-t border-border px-3 py-2">
                {source.snippets.map((snippet, snippetIndex) => (
                  <div className="flex flex-col gap-1" key={`${source.note_id}:${snippetIndex}`}>
                    <span className="text-[10px] font-semibold uppercase text-text-muted">
                      {formatMatchType(snippet.match_type)}
                    </span>
                    <p className="line-clamp-3 text-xs leading-relaxed text-text-secondary">
                      {snippet.text}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function AssistantBubble({ content, isPending, memoryUpdates, onSourceSelect, sources, status }: AssistantBubbleProps) {
  const displayContent =
    status === "no_evidence"
      ? "I couldn't sniff that out in this notebook yet. Try selecting a note or using a phrase you remember."
      : content;

  return (
    <div className="flex justify-start">
      <div className="max-w-[86%] rounded-2xl rounded-tl-md bg-surface px-4 py-4 text-[14px] leading-7 text-text-secondary shadow-soft">
        {isPending || status === "no_evidence" ? (
          <p className={isPending ? "whitespace-pre-wrap italic text-text-muted" : "whitespace-pre-wrap"}>{displayContent}</p>
        ) : (
          <div className="ask-answer">
            <Markdown
              components={{
                a({ href, children, ...props }) {
                  const match = /^#citation-(\d+)$/.exec(href ?? "");
                  if (!match) {
                    return <a href={href} {...props}>{children}</a>;
                  }

                  const sourceNumber = Number(match[1]);
                  const source = sources[sourceNumber - 1];
                  return (
                    <button
                      aria-label={`Open citation ${sourceNumber}: ${source.title}`}
                      className="ask-citation"
                      onClick={() => onSourceSelect(source.note_id)}
                      type="button"
                    >
                      {sourceNumber}
                    </button>
                  );
                },
              }}
              remarkPlugins={[remarkGfm, citationRemarkPlugin(sources.length)]}
            >
              {content}
            </Markdown>
          </div>
        )}
        <SourceList onSourceSelect={onSourceSelect} sources={sources} />
        {memoryUpdates ? <p className="mt-2 text-[11px] text-text-muted">Memory updated</p> : null}
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-2xl rounded-br-md bg-accent px-4 py-3.5 text-[14px] leading-relaxed text-accent-fg shadow-elevated">
        <p className="whitespace-pre-wrap font-medium">{content}</p>
      </div>
    </div>
  );
}

function ErrorBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[86%] rounded-2xl rounded-tl-md border border-error/60 bg-error-muted px-4 py-3.5 text-[14px] leading-relaxed text-error shadow-sm">
        <div className="flex items-start gap-2">
          <TriangleAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-error" aria-hidden="true" />
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    </div>
  );
}

type ThreadPanelProps = {
  activeThreadId: number | null;
  isPending: boolean;
  onClose: () => void;
  onDeleteThread: (threadId: number) => void;
  onNewThread: () => void;
  onRenameThread: (threadId: number, newTitle: string) => void;
  onSelectThread: (threadId: number) => void;
  threads: ChatThread[];
};

function ThreadPanel({
  activeThreadId,
  isPending,
  onClose,
  onDeleteThread,
  onNewThread,
  onRenameThread,
  onSelectThread,
  threads,
}: ThreadPanelProps) {
  const [editingThreadId, setEditingThreadId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingThreadId !== null) {
      editInputRef.current?.focus();
    }
  }, [editingThreadId]);

  function startEdit(thread: ChatThread) {
    setEditingThreadId(thread.id);
    setEditTitle(thread.title);
  }

  function cancelEdit() {
    setEditingThreadId(null);
    setEditTitle("");
  }

  function commitEdit(threadId: number) {
    const trimmed = editTitle.trim();
    if (trimmed) {
      onRenameThread(threadId, trimmed);
    }
    setEditingThreadId(null);
    setEditTitle("");
  }

  function handleSelectThread(threadId: number) {
    if (isPending || threadId === activeThreadId) {
      return;
    }
    onSelectThread(threadId);
    onClose();
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-bg" role="dialog" aria-label="Thread management">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-1 pb-3">
        <h3 className="text-sm font-semibold text-text-primary">Threads</h3>
        <button
          aria-label="Close thread panel"
          className="ml-auto rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"
          onClick={onClose}
          type="button"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pt-2">
        <button
          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
          disabled={isPending}
          onClick={() => onNewThread()}
          type="button"
        >
          <Plus size={14} aria-hidden="true" />
          New Chat
        </button>

        {threads.map((thread) => {
          const isActive = thread.id === activeThreadId;
          const isEditing = thread.id === editingThreadId;

          return (
            <div
              className={`flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors ${isActive ? "bg-accent-muted" : "hover:bg-surface-hover"}`}
              key={thread.id}
            >
              {isEditing ? (
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <input
                    className="surface-input min-w-0 flex-1 bg-bg px-2 py-1 text-[13px] text-text-primary outline-none"
                    disabled={isPending}
                    onChange={(event) => setEditTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        commitEdit(thread.id);
                      }
                      if (event.key === "Escape") {
                        cancelEdit();
                      }
                    }}
                    ref={editInputRef}
                    value={editTitle}
                  />
                  <button
                    aria-label="Save title"
                    className="rounded p-1 text-accent transition-colors hover:bg-accent-muted disabled:opacity-40"
                    disabled={isPending || !editTitle.trim()}
                    onClick={() => commitEdit(thread.id)}
                    type="button"
                  >
                    <Check size={13} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="Cancel rename"
                    className="rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
                    onClick={cancelEdit}
                    type="button"
                  >
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <>
                  <button
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors disabled:opacity-40 ${isActive ? "font-semibold text-accent" : "text-text-secondary hover:text-text-primary"}`}
                    disabled={isPending || isActive}
                    onClick={() => handleSelectThread(thread.id)}
                    title={thread.title}
                    type="button"
                  >
                    <span className="truncate">{thread.title}</span>
                  </button>
                  <button
                    aria-label={`Rename ${thread.title}`}
                    className="rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
                    disabled={isPending}
                    onClick={() => startEdit(thread)}
                    type="button"
                  >
                    <Pencil size={12} aria-hidden="true" />
                  </button>
                  <button
                    aria-label={`Delete ${thread.title}`}
                    className="rounded p-1 text-text-muted transition-colors hover:bg-error-muted hover:text-error disabled:opacity-40"
                    disabled={isPending}
                    onClick={() => onDeleteThread(thread.id)}
                    type="button"
                  >
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AskChat({
  askRef,
  activeThreadId,
  hasNotes = true,
  messages,
  threads,
  onSourceSelect,
  onDeleteThread,
  onNewThread,
  onRenameThread,
  onThreadChange,
  onSubmit,
  pendingMessageId,
  isSubmitDisabled = false,
  scopeLabel,
  submitDisabledMessage,
}: AskChatProps) {
  const [question, setQuestion] = useState("");
  const [isThreadPanelOpen, setIsThreadPanelOpen] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isPending = pendingMessageId !== null;
  const trimmedQuestion = question.trim();
  const isSendDisabled = !trimmedQuestion || isPending || isSubmitDisabled;
  const composerStatus = submitDisabledMessage ?? (isPending ? "I'm reading your notes…" : null);
  const emptyHelper = hasNotes
    ? "Ask Bun to sniff out decisions, trace sources, or spot gaps in the selected notes."
    : "Save your first note, then Bun can start sniffing through it.";
  const promptChips = [
    "What did Bun tuck away today?",
    "Find decisions with sources",
    "What still needs follow-up?",
  ];

  const handleSelectThread = useCallback(
    (threadId: number) => {
      onThreadChange?.(threadId);
    },
    [onThreadChange],
  );

  const handleDeleteFromPanel = useCallback(
    (threadId: number) => {
      onDeleteThread?.(threadId);
    },
    [onDeleteThread],
  );

  const handleRenameFromPanel = useCallback(
    (threadId: number, newTitle: string) => {
      onRenameThread?.(threadId, newTitle);
    },
    [onRenameThread],
  );

  useEffect(() => {
    const el = askRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [question, askRef]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pendingMessageId]);

  function submitQuestion() {
    if (isSendDisabled) {
      return;
    }

    onSubmit(trimmedQuestion);
    setQuestion("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submitQuestion();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    submitQuestion();
  }

  return (
    <section className="relative flex h-full min-h-0 w-full flex-col gap-2" aria-labelledby="ask-title">
      <header className="flex shrink-0 items-center gap-2 border-b border-border pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-muted">
          <Sparkles size={15} strokeWidth={2} className="text-accent" />
        </div>
        <h2 className="text-base font-semibold text-text-primary" id="ask-title">
          Ask Bun
        </h2>
        <span className="inline-flex items-center rounded-full bg-accent-muted px-2.5 py-0.5 text-[11px] font-medium text-text-muted">
          Sniffing through {scopeLabel}
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <button
            aria-label="Manage threads"
            className="rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
            disabled={isPending}
            onClick={() => setIsThreadPanelOpen(true)}
            title="Manage threads"
            type="button"
          >
            <MessageSquare size={14} aria-hidden="true" />
          </button>
        </div>
        <MemoryManager />
      </header>

      {isThreadPanelOpen ? (
        <ThreadPanel
          activeThreadId={activeThreadId}
          isPending={isPending}
          onClose={() => setIsThreadPanelOpen(false)}
          onDeleteThread={handleDeleteFromPanel}
          onNewThread={() => onNewThread?.()}
          onRenameThread={handleRenameFromPanel}
          onSelectThread={handleSelectThread}
          threads={threads}
        />
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-muted">
              <Sparkles size={16} strokeWidth={2} className="text-accent" />
            </div>
            <p className="max-w-[240px] text-xs leading-relaxed text-text-muted">{emptyHelper}</p>
            <div className="flex max-w-[260px] flex-wrap justify-center gap-1.5">
              {promptChips.map((prompt) => (
                <button
                  className="rounded-full border border-border bg-bg px-3 py-1.5 text-[13px] font-medium text-text-secondary transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-50"
                  disabled={isPending || isSubmitDisabled}
                  key={prompt}
                  onClick={() => setQuestion(prompt)}
                  type="button"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => {
          if (message.role === "user") {
            return <UserBubble content={message.content} key={message.id} />;
          }

          if (message.role === "assistant") {
            return (
              <AssistantBubble
                content={message.content}
                isPending={message.id === pendingMessageId}
                memoryUpdates={message.memoryUpdates}
                key={message.id}
                onSourceSelect={onSourceSelect}
                sources={message.sources}
                status={message.status}
              />
            );
          }

          return <ErrorBubble content={message.content} key={message.id} />;
        })}
        <div ref={transcriptEndRef} />
      </div>

      <form aria-busy={isPending} className="shrink-0" onSubmit={handleSubmit}>
        <div className="relative">
          <textarea
            aria-label="Ask a question about saved notes"
            className="surface-input w-full resize-none overflow-y-auto bg-bg px-3.5 pb-8 pl-3.5 pr-12 pt-3.5 text-[14px] leading-relaxed text-text-primary placeholder:text-text-muted outline-none transition-colors focus:bg-surface-hover disabled:opacity-60"
            disabled={isPending}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Bun about your notes…"
            ref={askRef}
            rows={2}
            value={question}
          />
          {composerStatus ? (
            <span className="pointer-events-none absolute bottom-2.5 left-3.5 max-w-[calc(100%-4rem)] truncate text-xs leading-relaxed text-text-muted">
              {composerStatus}
            </span>
          ) : null}
          <button
            aria-label="Send question"
            className="absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-accent transition-colors hover:bg-accent-muted hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:text-text-muted disabled:opacity-45"
            disabled={isSendDisabled}
            type="submit"
          >
            <Send size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </form>
    </section>
  );
}
