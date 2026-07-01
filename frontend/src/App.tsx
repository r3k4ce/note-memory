import { useCallback, useEffect, useRef, useState } from "react";

import { createNote, deleteNote, getNote, listNotes, searchNotes, updateNoteMetadata } from "./api";
import { CommandCenter } from "./components/CommandCenter";
import { NoteCard } from "./components/NoteCard";
import { ResultPanel } from "./components/ResultPanel";
import { useKeyboardShortcuts, type AppMode } from "./hooks/useKeyboardShortcuts";
import type { AskResponse, Note, NoteCardData, NoteMetadataUpdate, SearchResult } from "./types";

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
  const [isSavingMetadata, setIsSavingMetadata] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [metadataSaveError, setMetadataSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [lastDeletedNoteId, setLastDeletedNoteId] = useState<number | null>(null);

  const [mode, setMode] = useState<AppMode>("capture");
  const [askResult, setAskResult] = useState<AskResponse | null>(null);

  const searchRequestId = useRef(0);
  const captureRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);

  const isSearchActive = activeSearchQuery !== null;
  const visibleNotes: NoteCardData[] = isSearchActive ? searchResults : notes;

  const hasSetInitialMode = useRef(false);

  useKeyboardShortcuts(setMode, { captureRef, searchRef, askRef });

  useEffect(() => {
    if (!hasSetInitialMode.current && !isLoadingNotes && notes.length > 0) {
      hasSetInitialMode.current = true;
      setMode("search");
    }
  }, [isLoadingNotes, notes.length]);

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
      setMetadataSaveError(null);
      setDeleteError(null);

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

  async function handleUpdateNoteMetadata(noteId: number, body: NoteMetadataUpdate) {
    setIsSavingMetadata(true);
    setMetadataSaveError(null);

    try {
      const updatedNote = await updateNoteMetadata(noteId, body);
      setSelectedNote(updatedNote);
      setNotes((currentNotes) =>
        currentNotes.map((note) => (note.id === updatedNote.id ? updatedNote : note)),
      );
      setSearchResults((currentResults) =>
        currentResults.map((result) =>
          result.id === updatedNote.id
            ? {
                ...result,
                ai_title: updatedNote.ai_title,
                short_summary: updatedNote.short_summary,
                tags: updatedNote.tags,
                date_added: updatedNote.date_added,
              }
            : result,
        ),
      );
    } catch (error) {
      setMetadataSaveError(getErrorMessage(error, "Could not update note metadata."));
      throw error;
    } finally {
      setIsSavingMetadata(false);
    }
  }

  async function handleDeleteNote(noteId: number) {
    const title = selectedNote?.id === noteId ? selectedNote.ai_title : "this note";

    if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteNote(noteId);
      setNotes((currentNotes) => currentNotes.filter((note) => note.id !== noteId));
      setSearchResults((currentResults) => currentResults.filter((result) => result.id !== noteId));
      setSelectedNoteId(null);
      setSelectedNote(null);
      setDetailError(null);
      setMetadataSaveError(null);
      setLastDeletedNoteId(noteId);
    } catch (error) {
      setDeleteError(getErrorMessage(error, "Could not delete note."));
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <main className="min-h-screen bg-surface px-4 py-6 text-text-primary sm:px-8 sm:py-10">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand">Mapping Memory</p>
          <h1 className="text-3xl font-bold leading-tight text-text-primary sm:text-4xl">
            Notes workspace
          </h1>
        </div>
        <p className="max-w-md text-sm text-text-secondary">
          Capture, search, and explore your mapping notes with AI-powered organization.
        </p>
      </header>

      <CommandCenter
        askRef={askRef}
        captureRef={captureRef}
        draftText={draftText}
        isSaving={isSaving}
        isSearching={isSearching}
        mode={mode}
        onAskResult={setAskResult}
        onDraftTextChange={(value) => {
          setDraftText(value);
          if (saveError) {
            setSaveError(null);
          }
        }}
        onModeChange={setMode}
        onSave={handleSaveNote}
        onSearchChange={handleSearchTextChange}
        onSearchClear={clearSearch}
        onSearchSubmit={handleSearchSubmit}
        query={searchText}
        saveError={saveError}
        searchRef={searchRef}
      />

      <section
        className="mb-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]"
        aria-label="Notes workspace"
      >
        <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-card sm:p-5" aria-labelledby="note-list-title">
          <div className="mb-4">
            <p className="text-xs font-bold uppercase tracking-wide text-brand">
              {isSearchActive ? `Search results · ${activeSearchQuery}` : "Saved notes"}
            </p>
            <h2 className="text-lg font-semibold text-text-primary" id="note-list-title">
              {mode === "ask" && askResult ? "Referenced notes" : isSearchActive ? "Search results" : "Reference cards"}
            </h2>
          </div>

          {!isSearchActive && isLoadingNotes ? (
            <p className="mt-1 text-sm text-text-muted">Loading notes...</p>
          ) : null}
          {isSearchActive && isSearching ? (
            <p className="mt-1 text-sm text-text-muted">Searching...</p>
          ) : null}
          {!isSearchActive && listError ? <p className="mt-1 text-sm text-red-700">{listError}</p> : null}
          {isSearchActive && searchError ? (
            <p className="mt-1 text-sm text-red-700">{searchError}</p>
          ) : null}
          {!isSearchActive && !isLoadingNotes && !listError && notes.length === 0 ? (
            <p className="mt-1 text-sm text-text-muted">No notes saved yet. Use <kbd className="rounded bg-slate-100 px-1 py-0.5 text-xs font-medium text-text-caption">⌘N</kbd> to capture your first note.</p>
          ) : null}
          {isSearchActive && !isSearching && !searchError && searchResults.length === 0 ? (
            <p className="mt-1 text-sm text-text-muted">No notes found.</p>
          ) : null}

          <div className="flex flex-col gap-3">
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

        <ResultPanel
          askResult={askResult}
          deleteError={deleteError}
          deletedNoteId={lastDeletedNoteId}
          error={detailError}
          isDeleting={isDeleting}
          isLoading={isLoadingDetail}
          isSavingMetadata={isSavingMetadata}
          note={selectedNote}
          onDelete={handleDeleteNote}
          onSaveMetadata={handleUpdateNoteMetadata}
          saveError={metadataSaveError}
        />
      </section>
    </main>
  );
}
