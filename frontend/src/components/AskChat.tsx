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
  status?: "answered" | "no_evidence";
};

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
          Bun read {sources.length} {sources.length === 1 ? "card" : "cards"}
        </p>
      </div>
      <div className="mt-2 flex flex-col gap-1">
        {sources.map((source, index) => (
          <div
            className="rounded-card border border-border bg-bg transition-all hover:border-border-strong hover:bg-surface hover:shadow-soft"
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
                {source.date_added.slice(0, 10)}
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

function CitationChips({
  content,
  onSourceSelect,
  sources,
}: {
  content: string;
  onSourceSelect: (noteId: number) => void;
  sources: AskSource[];
}) {
  const citedIndexes = Array.from(content.matchAll(/\[(\d+)\]/g))
    .map((match) => Number(match[1]))
    .filter((sourceNumber, index, sourceNumbers) =>
      sourceNumber >= 1 && sourceNumber <= sources.length && sourceNumbers.indexOf(sourceNumber) === index,
    );

  if (citedIndexes.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Cited notes">
      {citedIndexes.map((sourceNumber) => {
        const source = sources[sourceNumber - 1];
        return (
          <button
            aria-label={`Open citation ${sourceNumber}: ${source.title}`}
            className="inline-flex h-6 items-center rounded-full border border-border bg-bg px-2 text-[11px] font-semibold tabular-nums text-accent transition-colors hover:border-border-strong hover:bg-surface"
            key={sourceNumber}
            onClick={() => onSourceSelect(source.note_id)}
            type="button"
          >
            [{sourceNumber}]
          </button>
        );
      })}
    </div>
  );
}

function AssistantBubble({ content, isPending, onSourceSelect, sources, status }: AssistantBubbleProps) {
  const displayContent =
    status === "no_evidence" ? "Bun couldn't find that in this notebook yet." : content;

  return (
    <div className="flex justify-start">
      <div className="max-w-[86%] rounded-2xl rounded-tl-md bg-surface px-4 py-4 text-[14px] leading-7 text-text-secondary shadow-soft">
        <p className={isPending ? "whitespace-pre-wrap italic text-text-muted" : "whitespace-pre-wrap"}>{displayContent}</p>
        {!isPending && status !== "no_evidence" ? (
          <CitationChips content={content} onSourceSelect={onSourceSelect} sources={sources} />
        ) : null}
        <SourceList onSourceSelect={onSourceSelect} sources={sources} />
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
  const promptChips = [
    "What did I save today?",
    "Find decisions with sources",
    "What is still missing?",
  ];

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
<section className="flex h-full min-h-0 w-full flex-col gap-3" aria-labelledby="ask-title">
      <header className="flex shrink-0 items-center gap-2 border-b border-border pb-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-muted">
          <Sparkles size={15} strokeWidth={2} className="text-accent" />
        </div>
        <h2 className="text-base font-semibold text-text-primary" id="ask-title">
          Ask Bun
        </h2>
        <span className="inline-flex items-center rounded-full bg-accent-muted px-2.5 py-0.5 text-[11px] font-medium text-text-muted">
          Searching · {scopeLabel}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-muted">
              <Sparkles size={16} strokeWidth={2} className="text-accent" />
            </div>
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

      <form aria-busy={isPending} className="flex shrink-0 flex-col gap-2 pt-2" onSubmit={handleSubmit}>
        <textarea
          aria-label="Ask a question about saved notes"
          className="w-full resize-none overflow-y-auto rounded-md border border-border bg-bg px-3.5 py-3.5 text-[14px] leading-relaxed text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
          disabled={isPending}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your notes..."
          ref={askRef}
          rows={2}
          value={question}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="min-w-0 flex-1 text-xs leading-relaxed text-text-muted">
            {submitDisabledMessage
              ?? (isPending
                 ? "Bun is reading your notes…"
                  : "Enter to send · Shift+Enter for a new line")}
          </span>
          <button
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2.5 text-[14px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            disabled={isSendDisabled}
            type="submit"
          >
            <Send size={13} strokeWidth={2} />
            {isPending ? "Reading…" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}
