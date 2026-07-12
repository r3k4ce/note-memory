import { Plus, Settings } from "lucide-react";
import { useRef, useState, type CSSProperties, type Ref, type RefObject } from "react";

import { SearchBar } from "../../components/SearchBar";
import { SettingsDialog } from "../../components/SettingsDialog";
import { BrowseTree, type BrowseTreeProps } from "./BrowseTree";
import { CategoryManager, type CategoryManagerProps } from "./CategoryManager";
import { SearchResults, type SearchResultsProps } from "./SearchResults";
import type { SidebarTab } from "./useNotebookController";
import type { Note } from "../../types";

const SIDEBAR_ACCENT_BUTTON_CLASS =
  "inline-flex items-center justify-center bg-accent text-black transition-colors hover:bg-accent-hover disabled:opacity-40";

export type NotesSidebarProps = {
  activeSearchQuery: string | null;
  browseTreeProps: BrowseTreeProps;
  captureShortcutLabel: string;
  categoryManagerProps: CategoryManagerProps;
  className: string;
  isDeleting: boolean;
  isLoadingNotes: boolean;
  isSaving: boolean;
  isSavingEdit: boolean;
  listError: string | null;
  notes: Note[];
  onClearSearch: () => void;
  onNewNote: () => void;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onSidebarTabChange: (tab: SidebarTab) => void;
  searchError: string | null;
  searchRef: RefObject<HTMLInputElement | null>;
  searchResultsProps: SearchResultsProps;
  searchText: string;
  sidebarRef: Ref<HTMLElement>;
  sidebarTab: SidebarTab;
  style: CSSProperties;
};

export function NotesSidebar({
  activeSearchQuery,
  browseTreeProps,
  captureShortcutLabel,
  categoryManagerProps,
  className,
  isDeleting,
  isLoadingNotes,
  isSaving,
  isSavingEdit,
  listError,
  notes,
  onClearSearch,
  onNewNote,
  onSearchChange,
  onSearchSubmit,
  onSidebarTabChange,
  searchError,
  searchRef,
  searchResultsProps,
  searchText,
  sidebarRef,
  sidebarTab,
  style,
}: NotesSidebarProps) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const isBrowseTab = sidebarTab === "browse";
  const isSearchTab = sidebarTab === "search";
  const searchStatus = searchResultsProps.isSearching
    ? "Bun is searching…"
    : searchError
      ? "Search hit a snag"
      : searchResultsProps.results.length === 0
        ? "No matching notes"
        : searchResultsProps.results.length === 1
          ? "1 match"
          : `${searchResultsProps.results.length} matches`;

  return (
    <aside aria-label="Notes sidebar" className={className} ref={sidebarRef} style={style}>
      <div className="shrink-0 px-3 py-6">
        <div className="flex items-center gap-2">
          <span className="bun-mark" aria-label="Notebun Bun mark" role="img">
            <span className="bun-mark-ear bun-mark-ear-left" aria-hidden="true" />
            <span className="bun-mark-ear bun-mark-ear-right" aria-hidden="true" />
            <span className="bun-mark-face" aria-hidden="true">
              <span className="bun-mark-eye bun-mark-eye-left" />
              <span className="bun-mark-eye bun-mark-eye-right" />
            </span>
          </span>
          <span className="text-lg font-semibold tracking-tight text-text-primary">Notebun</span>
        </div>
      </div>

      <div className="shrink-0 px-3 py-2.5">
        <button
          className={`${SIDEBAR_ACCENT_BUTTON_CLASS} w-full gap-1.5 rounded-xl px-3 py-3 text-[14px] font-semibold shadow-soft disabled:cursor-not-allowed`}
          disabled={isSaving || isSavingEdit || isDeleting}
          onClick={onNewNote}
          type="button"
        >
          <Plus size={16} strokeWidth={2} />
          New note
        </button>
      </div>

      <div className="shrink-0 px-3 py-2.5">
        <div
          aria-label="Sidebar mode"
          className="grid grid-cols-2 rounded-md bg-surface p-1"
          role="tablist"
        >
          <button
            aria-selected={isBrowseTab}
            className={`rounded px-3 py-3 text-[14px] transition-colors ${
              isBrowseTab
                ? "bg-bg text-accent shadow-soft font-semibold"
                : "text-text-muted hover:text-text-primary font-medium"
            }`}
            onClick={() => onSidebarTabChange("browse")}
            role="tab"
            type="button"
          >
            Browse
          </button>
          <button
            aria-selected={isSearchTab}
            className={`rounded px-3 py-3 text-[14px] transition-colors ${
              isSearchTab
                ? "bg-bg text-accent shadow-soft font-semibold"
                : "text-text-muted hover:text-text-primary font-medium"
            }`}
            onClick={() => onSidebarTabChange("search")}
            role="tab"
            type="button"
          >
            Search
          </button>
        </div>
      </div>

      {isSearchTab ? (
        <div className="shrink-0 px-3 py-2.5">
          <SearchBar
            isSearching={searchResultsProps.isSearching}
            onChange={onSearchChange}
            onClear={onClearSearch}
            onSubmit={onSearchSubmit}
            query={searchText}
            searchRef={searchRef}
          />
          {searchResultsProps.isActive ? (
            <div className="mt-2 flex items-center justify-between gap-2 px-0.5">
              <span className="min-w-0 truncate text-xs text-text-secondary">
                Results for “{activeSearchQuery}”
              </span>
              <span className="shrink-0 text-xs tabular-nums text-text-muted">
                {searchStatus}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {isBrowseTab ? <CategoryManager {...categoryManagerProps} /> : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2 pt-1">
        {isBrowseTab && isLoadingNotes ? (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-text-muted">
            <div className="h-3 w-3 animate-spin rounded-full border-2 border-border-strong border-t-accent" />
            Opening your notebook…
          </div>
        ) : null}

        {isBrowseTab && listError ? (
          <p className="px-2 py-3 text-xs text-error">{listError}</p>
        ) : null}

        {isBrowseTab && !isLoadingNotes && !listError && notes.length === 0 ? (
          <div className="mx-1.5 rounded-lg bg-surface p-4 text-center">
            <p className="text-sm font-medium text-text-secondary">Start your notebook</p>
            <p className="mt-1 text-xs text-text-muted">
              Create your first Markdown note, then Bun can help you find it later.
            </p>
            <p className="mt-2 text-xs text-text-muted">
              Press{" "}
              <kbd className="rounded bg-bg px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
                {captureShortcutLabel}
              </kbd>{" "}
              to create your first note
            </p>
          </div>
        ) : null}

        {isSearchTab ? <SearchResults {...searchResultsProps} /> : null}

        {isBrowseTab && !isLoadingNotes && !listError && notes.length > 0 ? (
          <BrowseTree {...browseTreeProps} />
        ) : null}
      </div>
      <footer className="flex shrink-0 justify-end px-3 py-2.5">
        <button
          aria-label="Open settings"
          className="rounded-md p-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
          onClick={() => setIsSettingsOpen(true)}
          ref={settingsTriggerRef}
          type="button"
        >
          <Settings size={17} aria-hidden="true" />
        </button>
      </footer>
      {isSettingsOpen ? (
        <SettingsDialog onClose={() => setIsSettingsOpen(false)} triggerRef={settingsTriggerRef} />
      ) : null}
    </aside>
  );
}
