import { AddNote } from "./components/AddNote";
import { AskPanel } from "./components/AskPanel";
import { NoteCard } from "./components/NoteCard";
import { NoteDetail } from "./components/NoteDetail";
import { SearchBar } from "./components/SearchBar";
import type { Note } from "./types";

const sampleNotes: Note[] = [
  {
    id: 1,
    original_text:
      "Met with Maya about the neighborhood archive. She remembered the old library mural and suggested asking the historical society for photos.",
    ai_title: "Neighborhood archive lead",
    short_summary: "Maya suggested checking historical society photos for the old library mural.",
    tags: ["archive", "library", "follow-up"],
    date_added: "2026-06-30T14:15:00Z",
    updated_at: "2026-06-30T14:15:00Z",
  },
  {
    id: 2,
    original_text:
      "Dad mentioned that the blue notebook has dates from the summer trips. Look for it in the cedar box.",
    ai_title: "Blue notebook location",
    short_summary: "The blue notebook may have summer trip dates and could be in the cedar box.",
    tags: ["family", "travel"],
    date_added: "2026-06-29T19:40:00Z",
    updated_at: "2026-06-29T19:40:00Z",
  },
  {
    id: 3,
    original_text:
      "The recipe card for the lemon cake had a note to use yogurt instead of milk.",
    ai_title: "Lemon cake recipe note",
    short_summary: "Use yogurt instead of milk for the lemon cake recipe.",
    tags: ["recipe"],
    date_added: "2026-06-28T11:05:00Z",
    updated_at: "2026-06-28T11:05:00Z",
  },
];

export default function App() {
  const selectedNote = sampleNotes[0];

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Mapping Memory</p>
          <h1>Notes workspace</h1>
        </div>
        <p className="status-copy">Static frontend shell. Backend actions are not connected yet.</p>
      </header>

      <section className="tool-grid" aria-label="Note tools">
        <AddNote />
        <SearchBar />
        <AskPanel />
      </section>

      <section className="workspace-grid" aria-label="Notes workspace">
        <aside className="list-panel" aria-labelledby="note-list-title">
          <div className="panel-heading">
            <p className="eyebrow">Saved notes</p>
            <h2 id="note-list-title">Card list</h2>
          </div>
          <div className="note-list">
            {sampleNotes.map((note) => (
              <NoteCard key={note.id} note={note} selected={note.id === selectedNote.id} />
            ))}
          </div>
        </aside>

        <NoteDetail note={selectedNote} />
      </section>
    </main>
  );
}
