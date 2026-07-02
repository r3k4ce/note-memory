import type { AskNoteScope } from "./types";

export const DEFAULT_ASK_NOTE_SCOPE: AskNoteScope = { mode: "all" };

export function isNoteSelectedForAsk(scope: AskNoteScope, noteId: number): boolean {
  return scope.mode === "all" || scope.noteIds.includes(noteId);
}

export function normalizeAskNoteScope(
  scope: AskNoteScope,
  availableNoteIds: number[],
): AskNoteScope {
  if (scope.mode === "all") {
    return DEFAULT_ASK_NOTE_SCOPE;
  }

  const selectedNoteIds = new Set(scope.noteIds);
  return {
    mode: "custom",
    noteIds: availableNoteIds.filter((noteId) => selectedNoteIds.has(noteId)),
  };
}

export function areAskNoteScopesEqual(left: AskNoteScope, right: AskNoteScope): boolean {
  if (left.mode !== right.mode) {
    return false;
  }

  if (left.mode === "all") {
    return true;
  }

  if (right.mode === "all") {
    return false;
  }

  return (
    left.noteIds.length === right.noteIds.length &&
    left.noteIds.every((noteId, index) => noteId === right.noteIds[index])
  );
}

export function toggleAskNoteScope(
  scope: AskNoteScope,
  noteId: number,
  availableNoteIds: number[],
): AskNoteScope {
  const selectedNoteIds =
    scope.mode === "all"
      ? new Set(availableNoteIds)
      : new Set(availableNoteIds.filter((availableNoteId) => scope.noteIds.includes(availableNoteId)));

  if (selectedNoteIds.has(noteId)) {
    selectedNoteIds.delete(noteId);
  } else if (availableNoteIds.includes(noteId)) {
    selectedNoteIds.add(noteId);
  }

  return {
    mode: "custom",
    noteIds: availableNoteIds.filter((availableNoteId) => selectedNoteIds.has(availableNoteId)),
  };
}

export function selectAllAskNotes(): AskNoteScope {
  return DEFAULT_ASK_NOTE_SCOPE;
}

export function clearAskNotes(): AskNoteScope {
  return { mode: "custom", noteIds: [] };
}

export function getAskNoteScopeSelectedCount(scope: AskNoteScope, totalNotes: number): number {
  if (scope.mode === "all") {
    return totalNotes;
  }

  return new Set(scope.noteIds).size;
}

export function formatAskNoteScopeSelectedCount(scope: AskNoteScope, totalNotes: number): string {
  if (scope.mode === "all") {
    return `All notes (${totalNotes})`;
  }

  const selectedCount = getAskNoteScopeSelectedCount(scope, totalNotes);
  return selectedCount === 1 ? "1 selected" : `${selectedCount} selected`;
}
