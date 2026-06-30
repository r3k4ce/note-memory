export function AddNote() {
  return (
    <section className="tool-panel" aria-labelledby="add-note-title">
      <div className="panel-heading">
        <p className="eyebrow">Capture</p>
        <h2 id="add-note-title">Add Note</h2>
      </div>
      <textarea
        className="field field-textarea"
        disabled
        placeholder="Paste a memory, idea, or observation..."
        rows={5}
      />
      <button className="button" disabled type="button">
        Add note
      </button>
    </section>
  );
}
