import { useCallback, useEffect, useRef, useState } from "react";

import { createNote, getNote, listNotes, searchNotes } from "./api";
import { AddNote } from "./components/AddNote";
import { AskPanel } from "./components/AskPanel";
import { NoteCard } from "./components/NoteCard";
import { NoteDetail } from "./components/NoteDetail";
import { SearchBar } from "./components/SearchBar";
import type { Note, NoteCardData, SearchResult } from "./types";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [draftText, setDraftText] = useState("");
  const [searchText, setSearchText] = useState("");
  const [activeSearchQuery, setActiveSearchQuery] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoadingNotes, setIsLoadingNotes] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRequestId = useRef(0);

  const selectNote = useCallback((noteId: number) => {
    setSelectedNoteId(noteId);
  }, []);

  const clearSearch = useCallback(() => {
    searchRequestId.current += 1;
    setSearchText("");
    setActiveSearchQuery(null);
    setSearchResults([]);
    setSearchError(null);
    setIsSearching(false);
  }, []);

  const handleSearchTextChange = useCallback((value: string) => {
    setSearchText(value);

    if (!value.trim()) {
      searchRequestId.current += 1;
      setActiveSearchQuery(null);
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function loadNotes() {
      setIsLoadingNotes(true);
      setListError(null);

      try {
        const loadedNotes = await listNotes();
        if (ignore) {
          return;
        }

        setNotes(loadedNotes);
        setSelectedNoteId(loadedNotes[0]?.id ?? null);
      } catch (error) {
        if (ignore) {
          return;
        }

        setListError(getErrorMessage(error, "Could not load notes."));
        setNotes([]);
        setSelectedNoteId(null);
        setSelectedNote(null);
      } finally {
        if (!ignore) {
          setIsLoadingNotes(false);
        }
      }
    }

    void loadNotes();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (selectedNoteId === null) {
      return;
    }

    const noteId = selectedNoteId;
    let ignore = false;

    async function loadSelectedNote() {
      setIsLoadingDetail(true);
      setDetailError(null);

      try {
        const loadedNote = await getNote(noteId);
        if (!ignore) {
          setSelectedNote(loadedNote);
        }
      } catch (error) {
        if (!ignore) {
          setSelectedNote(null);
          setDetailError(getErrorMessage(error, "Could not load note detail."));
        }
      } finally {
        if (!ignore) {
          setIsLoadingDetail(false);
        }
      }
    }

    void loadSelectedNote();

    return () => {
      ignore = true;
    };
  }, [selectedNoteId]);

  async function handleSearchSubmit() {
    const query = searchText.trim();
    if (!query) {
      clearSearch();
      return;
    }

    const requestId = searchRequestId.current + 1;
    searchRequestId.current = requestId;
    setActiveSearchQuery(query);
    setSearchResults([]);
    setSearchError(null);
    setIsSearching(true);

    try {
      const results = await searchNotes(query);
      if (searchRequestId.current === requestId) {
        setSearchResults(results);
      }
    } catch (error) {
      if (searchRequestId.current === requestId) {
        setSearchResults([]);
        setSearchError(getErrorMessage(error, "Could not search notes."));
      }
    } finally {
      if (searchRequestId.current === requestId) {
        setIsSearching(false);
      }
    }
  }

  async function handleSaveNote() {
    if (!draftText.trim()) {
      setSaveError("Enter note text before saving.");
      return;
    }

    setIsSaving(true);
    setSaveError(null);

    try {
      const savedNote = await createNote(draftText);
      clearSearch();
      setNotes((currentNotes) => [savedNote, ...currentNotes.filter((note) => note.id !== savedNote.id)]);
      setDraftText("");
      setSelectedNote(savedNote);
      setSelectedNoteId(savedNote.id);
    } catch (error) {
      setSaveError(getErrorMessage(error, "Could not save note."));
    } finally {
      setIsSaving(false);
    }
  }

  const isSearchActive = activeSearchQuery !== null;
  const visibleNotes: NoteCardData[] = isSearchActive ? searchResults : notes;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Mapping Memory</p>
          <h1>Notes workspace</h1>
        </div>
        <p className="status-copy">Capture notes with fallback metadata from the local backend.</p>
      </header>

      <section className="tool-grid" aria-label="Note tools">
        <AddNote
          draftText={draftText}
          error={saveError}
          isSaving={isSaving}
          onDraftTextChange={(value) => {
            setDraftText(value);
            if (saveError) {
              setSaveError(null);
            }
          }}
          onSave={handleSaveNote}
        />
        <SearchBar
          isSearching={isSearching}
          onChange={handleSearchTextChange}
          onClear={clearSearch}
          onSubmit={handleSearchSubmit}
          query={searchText}
        />
        <AskPanel />
      </section>

      <section className="workspace-grid" aria-label="Notes workspace">
        <aside className="list-panel" aria-labelledby="note-list-title">
          <div className="panel-heading">
            <p className="eyebrow">{isSearchActive ? "Search results" : "Saved notes"}</p>
            <h2 id="note-list-title">
              {isSearchActive ? `Results for "${activeSearchQuery}"` : "Card list"}
            </h2>
          </div>

          {!isSearchActive && isLoadingNotes ? (
            <p className="muted-copy list-state">Loading notes...</p>
          ) : null}
          {isSearchActive && isSearching ? (
            <p className="muted-copy list-state">Searching...</p>
          ) : null}
          {!isSearchActive && listError ? <p className="error-message list-state">{listError}</p> : null}
          {isSearchActive && searchError ? (
            <p className="error-message list-state">{searchError}</p>
          ) : null}
          {!isSearchActive && !isLoadingNotes && !listError && notes.length === 0 ? (
            <p className="muted-copy list-state">No notes saved yet.</p>
          ) : null}
          {isSearchActive && !isSearching && !searchError && searchResults.length === 0 ? (
            <p className="muted-copy list-state">No notes found.</p>
          ) : null}

          <div className="note-list">
            {visibleNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onSelect={selectNote}
                selected={note.id === selectedNoteId}
              />
            ))}
          </div>
        </aside>

        <NoteDetail error={detailError} isLoading={isLoadingDetail} note={selectedNote} />
      </section>
    </main>
  );
}
