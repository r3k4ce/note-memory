import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, FileText, Quote, Send, Sparkles, TriangleAlert } from "lucide-react";

import type { AskSource, ChatMessage } from "../types";

type AskChatProps = {
  askRef: RefObject<HTMLTextAreaElement | null>;
  messages: ChatMessage[];
  onSourceSelect: (noteId: number) => void;
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
};

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
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
          Sources · {sources.length}
        </p>
      </div>
      <div className="mt-2 flex flex-col gap-1.5">
        {sources.map((source) => (
          <button
            aria-label={`Open cited note: ${source.title}`}
            className="flex cursor-pointer items-center gap-2 rounded-card border border-border bg-bg px-3 py-2 text-left transition-colors hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
            key={source.note_id}
            onClick={() => onSourceSelect(source.note_id)}
            type="button"
          >
            <FileText size={12} strokeWidth={2} className="shrink-0 text-text-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">{source.title}</span>
            <time className="shrink-0 text-[11px] tabular-nums text-text-muted" dateTime={source.date_added}>
              {source.date_added.slice(0, 10)}
            </time>
            <ArrowUpRight size={12} strokeWidth={2} className="shrink-0 text-text-muted" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function AssistantBubble({ content, isPending, onSourceSelect, sources }: AssistantBubbleProps) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[86%] rounded-2xl rounded-tl-md bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-text-secondary shadow-sm">
        <p className={isPending ? "whitespace-pre-wrap italic text-text-muted" : "whitespace-pre-wrap"}>{content}</p>
        <SourceList onSourceSelect={onSourceSelect} sources={sources} />
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-[13px] leading-relaxed text-accent-fg shadow-sm">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function ErrorBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[86%] rounded-2xl rounded-tl-md border border-error/60 bg-error-muted px-3.5 py-2.5 text-[13px] leading-relaxed text-error shadow-sm">
        <div className="flex items-start gap-2">
          <TriangleAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-error" aria-hidden="true" />
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    </div>
  );
}

export function AskChat({
  askRef,
  messages,
  onSourceSelect,
  onSubmit,
  pendingMessageId,
  isSubmitDisabled = false,
  scopeLabel,
  submitDisabledMessage,
}: AskChatProps) {
  const [question, setQuestion] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isPending = pendingMessageId !== null;
  const trimmedQuestion = question.trim();
  const isSendDisabled = !trimmedQuestion || isPending || isSubmitDisabled;

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
    <section className="flex h-full min-h-0 w-full flex-col gap-3" aria-labelledby="ask-title">
      <header className="flex shrink-0 flex-col gap-1 pb-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-muted">
            <Sparkles size={13} strokeWidth={2} className="text-accent" />
          </div>
          <h2 className="text-[13px] font-semibold text-text-primary" id="ask-title">
            Ask Bun
          </h2>
        </div>
        <p className="pl-8 text-[11px] text-text-muted">Scope · {scopeLabel}</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1" aria-live="polite">
        <AssistantBubble
          content={"Ask about your saved notes.\n\nBun cites the notes it uses."}
          onSourceSelect={onSourceSelect}
          sources={[]}
        />
        {messages.map((message) => {
          if (message.role === "user") {
            return <UserBubble content={message.content} key={message.id} />;
          }

          if (message.role === "assistant") {
            return (
              <AssistantBubble
                content={message.content}
                isPending={message.id === pendingMessageId}
                key={message.id}
                onSourceSelect={onSourceSelect}
                sources={message.sources}
              />
            );
          }

          return <ErrorBubble content={message.content} key={message.id} />;
        })}
        <div ref={transcriptEndRef} />
      </div>

      <form aria-busy={isPending} className="flex shrink-0 flex-col gap-2 pt-2" onSubmit={handleSubmit}>
        <textarea
          aria-label="Ask a question about saved notes"
          className="min-h-20 w-full resize-y rounded-md border border-border bg-bg px-3 py-2.5 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
          disabled={isPending}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your notes..."
          ref={askRef}
          rows={3}
          value={question}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-text-muted">
            {submitDisabledMessage
              ?? (isPending
                ? "Reading your notes…"
                : "Press Enter to send, Shift+Enter for a new line.")}
          </span>
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isSendDisabled}
            type="submit"
          >
            <Send size={13} strokeWidth={2} />
            {isPending ? "Reading..." : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
