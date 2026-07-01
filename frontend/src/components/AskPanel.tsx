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
      setAskError(getErrorMessage(error, "Could not ask notes."));
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
    <form
      className="flex flex-col gap-3"
      aria-labelledby="ask-title"
      onSubmit={handleSubmit}
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-accent">Explore</p>
        <h2 className="text-base font-semibold text-text-primary" id="ask-title">
          Ask saved notes
        </h2>
      </div>
      <textarea
        aria-label="Ask a question about saved notes"
        className="min-h-28 w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-4 focus:ring-accent/10 disabled:opacity-60"
        disabled={isAsking}
        onChange={(event) => handleQuestionChange(event.target.value)}
        placeholder="Ask a question about your saved mapping notes..."
        ref={askRef}
        rows={4}
        value={question}
      />
      {askError ? <p className="text-sm text-red-700">{askError}</p> : null}
      <button
        className="w-fit rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        disabled={isAsking}
        type="submit"
      >
        {isAsking ? "Reading saved notes..." : "Ask"}
      </button>
    </form>
  );
}
