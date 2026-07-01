import type { RefObject } from "react";

import type { AppMode } from "../hooks/useKeyboardShortcuts";
import { SegmentedControl } from "./SegmentedControl";
import { AddNote } from "./AddNote";
import { SearchBar } from "./SearchBar";
import { AskPanel } from "./AskPanel";

type CommandCenterProps = {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;

  captureRef: RefObject<HTMLTextAreaElement | null>;
  draftText: string;
  isSaving: boolean;
  saveError: string | null;
  onDraftTextChange: (value: string) => void;
  onSave: () => void;

  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  isSearching: boolean;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  onSearchSubmit: () => void;

  askRef: RefObject<HTMLTextAreaElement | null>;
  onAskResult: (result: import("../types").AskResponse | null) => void;
};

export function CommandCenter({
  mode,
  onModeChange,
  captureRef,
  draftText,
  isSaving,
  saveError,
  onDraftTextChange,
  onSave,
  searchRef,
  query,
  isSearching,
  onSearchChange,
  onSearchClear,
  onSearchSubmit,
  askRef,
  onAskResult,
}: CommandCenterProps) {
  return (
    <section className="mb-6" aria-label="Command center">
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card sm:p-4">
        <SegmentedControl mode={mode} onModeChange={onModeChange} />

        <div className="mt-3">
          {mode === "capture" && (
            <AddNote
              captureRef={captureRef}
              draftText={draftText}
              error={saveError}
              isSaving={isSaving}
              onDraftTextChange={onDraftTextChange}
              onSave={onSave}
            />
          )}

          {mode === "search" && (
            <SearchBar
              isSearching={isSearching}
              onChange={onSearchChange}
              onClear={onSearchClear}
              onSubmit={onSearchSubmit}
              query={query}
              searchRef={searchRef}
            />
          )}

          {mode === "ask" && (
            <AskPanel
              askRef={askRef}
              onResult={onAskResult}
            />
          )}
        </div>
      </div>
    </section>
  );
}
