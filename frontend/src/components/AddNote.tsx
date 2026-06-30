type AddNoteProps = {
  draftText: string;
  error: string | null;
  isSaving: boolean;
  onDraftTextChange: (value: string) => void;
  onSave: () => void;
};

export function AddNote({ draftText, error, isSaving, onDraftTextChange, onSave }: AddNoteProps) {
  return (
    <section className="tool-panel" aria-labelledby="add-note-title">
      <div className="panel-heading">
        <p className="eyebrow">Capture</p>
        <h2 id="add-note-title">Add Note</h2>
      </div>
      <textarea
        className="field field-textarea"
        disabled={isSaving}
        onChange={(event) => onDraftTextChange(event.target.value)}
        placeholder="Paste a memory, idea, or observation..."
        rows={5}
        value={draftText}
      />
      {error ? <p className="error-message">{error}</p> : null}
      <button className="button" disabled={isSaving} onClick={onSave} type="button">
        {isSaving ? "Saving..." : "Save"}
      </button>
    </section>
  );
}
