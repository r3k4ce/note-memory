import type { FormEvent, RefObject } from "react";
import { useState } from "react";

import { askQuestion } from "../api";
import type { AskResponse } from "../types";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

type AskPanelProps = {
  askRef: RefObject<HTMLTextAreaElement | null>;
  onResult: (result: AskResponse | null) => void;
};

export function AskPanel({ askRef, onResult }: AskPanelProps) {
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      onResult(null);
      setAskError("Enter a question before asking.");
      return;
    }

    setIsAsking(true);
    setAskError(null);
    onResult(null);

    try {
      onResult(await askQuestion(trimmedQuestion));
    } catch (error) {
      setAskError(getErrorMessage(error, "Could not reach the knowledge base."));
    } finally {
      setIsAsking(false);
    }
  }

  function handleQuestionChange(value: string) {
    setQuestion(value);
    setAskError(null);
    onResult(null);
  }

  return (
    <form className="flex flex-col gap-3" aria-labelledby="ask-title" onSubmit={handleSubmit}>
      <h2 className="sr-only" id="ask-title">
        Ask your notes
      </h2>
      <textarea
        aria-label="Ask a question about saved notes"
        className="min-h-32 w-full resize-y rounded-lg border border-border bg-surface-raised px-3.5 py-3 text-sm leading-relaxed text-text-primary placeholder:text-text-muted outline-none transition-colors focus:border-border-strong focus:bg-surface-hover disabled:opacity-60"
        disabled={isAsking}
        onChange={(event) => handleQuestionChange(event.target.value)}
        placeholder="Ask anything about your saved mapping notes — answers are grounded in what you've captured."
        ref={askRef}
        rows={4}
        value={question}
      />
      {askError ? <p className="text-xs text-error">{askError}</p> : null}
      <div className="flex items-center gap-2">
        <button
          className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-black transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          disabled={isAsking}
          type="submit"
        >
          {isAsking ? "Reading notes..." : "Ask"}
        </button>
        <span className="text-[11px] text-text-muted">⌘I to focus</span>
      </div>
    </form>
  );
}
