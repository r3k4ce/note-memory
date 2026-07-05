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
  return setAskNoteScopeSelected(scope, [noteId], !isNoteSelectedForAsk(scope, noteId), availableNoteIds);
}

export function setAskNoteScopeSelected(
  scope: AskNoteScope,
  noteIds: number[],
  selected: boolean,
  availableNoteIds: number[],
): AskNoteScope {
  const selectedNoteIds =
    scope.mode === "all"
      ? new Set(availableNoteIds)
      : new Set(availableNoteIds.filter((availableNoteId) => scope.noteIds.includes(availableNoteId)));

  const availableNoteIdSet = new Set(availableNoteIds);
  for (const noteId of noteIds) {
    if (!availableNoteIdSet.has(noteId)) {
      continue;
    }

    if (selected) {
      selectedNoteIds.add(noteId);
    } else {
      selectedNoteIds.delete(noteId);
    }
  }

  if (selectedNoteIds.size === availableNoteIds.length) {
    return DEFAULT_ASK_NOTE_SCOPE;
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
    return "All notes selected";
  }

  const selectedCount = getAskNoteScopeSelectedCount(scope, totalNotes);
  if (selectedCount === 0) {
    return "No notes selected";
  }

  return selectedCount === 1 ? "1 note selected" : `${selectedCount} notes selected`;
}
