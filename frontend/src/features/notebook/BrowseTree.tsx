import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import type { DragEvent } from "react";

import { NoteCard } from "../../components/NoteCard";
import type { Note } from "../../types";
import type { BrowseFolder, CategoryFilter, NoteDropTarget } from "./useNotebookController";

export type BrowseTreeProps = {
  browseFolders: BrowseFolder[];
  dropTargetKey: string | null;
  expandedFolderKeys: Set<string>;
  getFolderDropTarget: (folder: BrowseFolder) => NoteDropTarget;
  isNoteSelected: (noteId: number) => boolean;
  notes: Note[];
  onCategoryFilterChange: (filter: CategoryFilter) => void;
  onFolderClick: (folder: BrowseFolder) => void;
  onFolderDragLeave: (target: NoteDropTarget) => void;
  onFolderDragOver: (event: DragEvent<HTMLButtonElement>, target: NoteDropTarget) => void;
  onFolderDrop: (event: DragEvent<HTMLButtonElement>, target: NoteDropTarget) => void;
  onNoteDragEnd: () => void;
  onNoteDragStart: (event: DragEvent<HTMLButtonElement>, noteId: number) => void;
  onNoteSelect: (noteId: number) => void;
  onSetSourceNotesSelected: (noteIds: number[], selected: boolean) => void;
  onToggleAllNotes: () => void;
  onToggleNoteScope: (noteId: number) => void;
  selectedCategoryFilter: CategoryFilter;
  selectedNoteId: number | null;
  useAllNotes: boolean;
};

export function BrowseTree({
  browseFolders,
  dropTargetKey,
  expandedFolderKeys,
  getFolderDropTarget,
  isNoteSelected,
  notes,
  onCategoryFilterChange,
  onFolderClick,
  onFolderDragLeave,
  onFolderDragOver,
  onFolderDrop,
  onNoteDragEnd,
  onNoteDragStart,
  onNoteSelect,
  onSetSourceNotesSelected,
  onToggleAllNotes,
  onToggleNoteScope,
  selectedCategoryFilter,
  selectedNoteId,
  useAllNotes,
}: BrowseTreeProps) {
  return (
    <div aria-label="Browse notes" className="flex flex-col gap-1" role="tree">
      <div className="flex items-center gap-1 rounded-md pr-1">
        <input
          aria-label="Use all notes for Ask"
          checked={useAllNotes}
          className="ask-scope-checkbox ml-2.5 shrink-0 rounded border-border bg-surface accent-accent"
          onChange={onToggleAllNotes}
          type="checkbox"
        />
        <button
          aria-selected={selectedCategoryFilter === "all"}
          className={`sidebar-row flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
            selectedCategoryFilter === "all"
              ? "bg-surface text-text-primary"
              : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
          }`}
          onClick={() => onCategoryFilterChange("all")}
          type="button"
        >
          <FileText aria-hidden="true" className="shrink-0" size={16} strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate">All notes</span>
          <span aria-hidden="true" className="shrink-0 text-[12px] tabular-nums text-text-muted">
            {notes.length}
          </span>
        </button>
      </div>

      {browseFolders.map((folder) => {
        const isExpanded = expandedFolderKeys.has(folder.key);
        const isSelected = selectedCategoryFilter === folder.filter;
        const FolderIcon = isExpanded ? FolderOpen : Folder;
        const folderNoteIds = folder.notes.map((note) => note.id);
        const selectedFolderNoteCount = folderNoteIds.filter(isNoteSelected).length;
        const isFolderAskSelected =
          folderNoteIds.length > 0 && selectedFolderNoteCount === folderNoteIds.length;
        const isFolderAskPartiallySelected =
          selectedFolderNoteCount > 0 && selectedFolderNoteCount < folderNoteIds.length;
        const folderDropTarget = getFolderDropTarget(folder);
        const isDropTarget = dropTargetKey === folder.key;

        return (
          <div className="flex flex-col gap-1" key={folder.key}>
            <div className="flex items-center gap-1 rounded-md pr-1">
              <input
                aria-label={`Use ${folder.label} category for Ask`}
                checked={isFolderAskSelected}
                className="ask-scope-checkbox ml-2.5 shrink-0 rounded border-border bg-surface accent-accent disabled:opacity-30"
                disabled={folderNoteIds.length === 0}
                onChange={() =>
                  onSetSourceNotesSelected(folderNoteIds, !isFolderAskSelected)
                }
                ref={(input) => {
                  if (input) {
                    input.indeterminate = isFolderAskPartiallySelected;
                  }
                }}
                type="checkbox"
              />
              <button
                aria-expanded={isExpanded}
                aria-selected={isSelected}
                className={`sidebar-row flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-[14px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
                  isDropTarget
                    ? "bg-accent-muted text-text-primary ring-1 ring-accent/40"
                    : isSelected
                      ? "bg-surface text-text-primary"
                      : "text-text-muted hover:bg-surface-hover hover:text-text-secondary"
                }`}
                onClick={() => onFolderClick(folder)}
                onDragLeave={() => onFolderDragLeave(folderDropTarget)}
                onDragOver={(event) => onFolderDragOver(event, folderDropTarget)}
                onDrop={(event) => onFolderDrop(event, folderDropTarget)}
                title={folder.label}
                type="button"
              >
                {isExpanded ? (
                  <ChevronDown
                    aria-hidden="true"
                    className="shrink-0"
                    size={16}
                    strokeWidth={2}
                  />
                ) : (
                  <ChevronRight
                    aria-hidden="true"
                    className="shrink-0"
                    size={16}
                    strokeWidth={2}
                  />
                )}
                <FolderIcon aria-hidden="true" className="shrink-0" size={16} strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate">{folder.label}</span>
                <span aria-hidden="true" className="shrink-0 text-[12px] tabular-nums text-text-muted">
                  {folder.notes.length}
                </span>
              </button>
            </div>

            {isExpanded ? (
              <div className="ml-4 flex flex-col gap-1.5 pl-1.5" role="group">
                {folder.notes.length > 0 ? (
                  folder.notes.map((note) => (
                    <NoteCard
                      askScopeSelected={isNoteSelected(note.id)}
                      draggable
                      icon={FileText}
                      key={note.id}
                      mode="browse"
                      note={note}
                      onAskScopeToggle={onToggleNoteScope}
                      onDragEnd={onNoteDragEnd}
                      onDragStart={(event) => onNoteDragStart(event, note.id)}
                      onSelect={onNoteSelect}
                      selected={note.id === selectedNoteId}
                      showAskScopeCheckbox
                    />
                  ))
                ) : (
                  <p className="px-2 py-2 text-xs text-text-muted">No notes in this section yet.</p>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
