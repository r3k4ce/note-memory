export function AskPanel() {
  return (
    <section className="tool-panel" aria-labelledby="ask-title">
      <div className="panel-heading">
        <p className="eyebrow">Explore</p>
        <h2 id="ask-title">Ask</h2>
      </div>
      <textarea
        className="field field-textarea"
        disabled
        placeholder="Ask a question about saved notes..."
        rows={5}
      />
      <button className="button" disabled type="button">
        Ask
      </button>
    </section>
  );
}
