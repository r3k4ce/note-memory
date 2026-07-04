import type { FormEvent, KeyboardEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { Send, Sparkles } from "lucide-react";

import { APP_SHORTCUTS } from "../hooks/useKeyboardShortcuts";
import type { AskSource, ChatMessage } from "../types";

type AskChatProps = {
  askRef: RefObject<HTMLTextAreaElement | null>;
  messages: ChatMessage[];
  onSubmit: (question: string) => void;
  pendingMessageId: string | null;
  isSubmitDisabled?: boolean;
  scopeLabel: string;
  submitDisabledMessage?: string;
};

type AssistantBubbleProps = {
  content: string;
  sources: AskSource[];
};

function SourceList({ sources }: { sources: AskSource[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 border-t border-border pt-3" aria-label="Supporting sources">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
        Sources · {sources.length}
      </p>
      <div className="mt-2 flex flex-col gap-1.5">
        {sources.map((source) => (
          <article
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-raised px-3 py-2"
            key={source.note_id}
          >
            <h3 className="min-w-0 truncate text-[13px] font-medium text-text-secondary">{source.title}</h3>
            <time className="shrink-0 text-[10px] tabular-nums text-text-muted" dateTime={source.date_added}>
              {source.date_added.slice(0, 10)}
            </time>
          </article>
        ))}
      </div>
    </div>
  );
}

function AssistantBubble({ content, sources }: AssistantBubbleProps) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[86%] rounded-md border border-border bg-surface px-3 py-2.5 text-[13px] leading-relaxed text-text-secondary">
        <p className="whitespace-pre-wrap">{content}</p>
        <SourceList sources={sources} />
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[78%] rounded-md bg-accent px-3 py-2.5 text-[13px] leading-relaxed text-black">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

function ErrorBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[86%] rounded-md border border-error/40 bg-error-muted px-3 py-2.5 text-[13px] leading-relaxed text-text-primary">
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    </div>
  );
}

export function AskChat({
  askRef,
  messages,
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
      <header className="flex shrink-0 flex-col gap-1 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-muted">
            <Sparkles size={13} strokeWidth={2} className="text-accent" />
          </div>
          <h2 className="text-[13px] font-semibold text-text-primary" id="ask-title">
            Notes assistant
          </h2>
        </div>
        <p className="pl-8 text-[11px] text-text-muted">Scope · {scopeLabel}</p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1" aria-live="polite">
        <AssistantBubble
          content="Ask about notes in this scope. Answers include sources."
          sources={[]}
        />
        {messages.map((message) => {
          if (message.role === "user") {
            return <UserBubble content={message.content} key={message.id} />;
          }

          if (message.role === "assistant") {
            return <AssistantBubble content={message.content} key={message.id} sources={message.sources} />;
          }

          return <ErrorBubble content={message.content} key={message.id} />;
        })}
        <div ref={transcriptEndRef} />
      </div>

      <form className="flex shrink-0 flex-col gap-2 border-t border-border pt-3" onSubmit={handleSubmit}>
        <textarea
          aria-label="Ask a question about saved notes"
          className="min-h-20 w-full resize-y rounded-md border border-border bg-surface-raised px-3 py-2.5 text-[13px] leading-relaxed text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
          disabled={isPending}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the assistant..."
          ref={askRef}
          rows={3}
          value={question}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-text-muted">
            {submitDisabledMessage ?? `Enter to send · Shift+Enter for newline · ${APP_SHORTCUTS.ask.label} to focus`}
          </span>
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
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
