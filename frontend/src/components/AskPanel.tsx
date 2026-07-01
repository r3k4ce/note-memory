import type { FormEvent } from "react";
import { useState } from "react";

import { askQuestion } from "../api";
import type { AskResponse } from "../types";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AskPanel() {
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResponse | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setAskResult(null);
      setAskError("Enter a question before asking.");
      return;
    }

    setIsAsking(true);
    setAskError(null);
    setAskResult(null);

    try {
      setAskResult(await askQuestion(trimmedQuestion));
    } catch (error) {
      setAskError(getErrorMessage(error, "Could not ask notes."));
    } finally {
      setIsAsking(false);
    }
  }

  function handleQuestionChange(value: string) {
    setQuestion(value);
    setAskError(null);
    setAskResult(null);
  }

  return (
    <form className="tool-panel" aria-labelledby="ask-title" onSubmit={handleSubmit}>
      <div className="panel-heading">
        <p className="eyebrow">Explore</p>
        <h2 id="ask-title">Ask</h2>
      </div>
      <textarea
        aria-label="Ask a question about saved notes"
        className="field field-textarea"
        disabled={isAsking}
        onChange={(event) => handleQuestionChange(event.target.value)}
        placeholder="Ask a question about saved notes..."
        rows={5}
        value={question}
      />
      {askError ? <p className="error-message">{askError}</p> : null}
      <button className="button" disabled={isAsking} type="submit">
        {isAsking ? "Asking..." : "Ask"}
      </button>

      {askResult ? (
        <div className="ask-result" aria-live="polite">
          <p className="ask-answer">{askResult.answer}</p>
          {askResult.sources.length > 0 ? (
            <div className="ask-source-list" aria-label="Supporting sources">
              {askResult.sources.map((source) => (
                <article className="ask-source-card" key={source.note_id}>
                  <h3 className="ask-source-title">{source.title}</h3>
                  <time dateTime={source.date_added}>{source.date_added}</time>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
