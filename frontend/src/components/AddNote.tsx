import type { ReactNode, RefObject } from "react";
import { Save } from "lucide-react";

import { APP_SHORTCUTS } from "../hooks/useKeyboardShortcuts";
import type { Category } from "../types";
import { MarkdownPane, type MarkdownPaneHandle } from "./MarkdownPane";
import { MarkdownPreview } from "./MarkdownPreview";
import { NoteToolbar, TOOLBAR_ACCENT_BUTTON_CLASS } from "./NoteToolbar";

type AddNoteProps = {
  captureRef: RefObject<MarkdownPaneHandle | null>;
  categories: Category[];
  draftText: string;
  error: string | null;
  isSaving: boolean;
  onDraftTextChange: (value: string) => void;
  onSave: () => void;
  readMode?: boolean;
  toolbarControls: ReactNode;
};

export function AddNote({
  captureRef,
  categories,
  draftText,
  error,
  isSaving,
  onDraftTextChange,
  onSave,
  readMode = false,
  toolbarControls,
}: AddNoteProps) {
  const statusText = draftText.trim() ? `${draftText.length} chars` : `${APP_SHORTCUTS.capture.label} to focus`;
  const toolbar = (
    <NoteToolbar
      actions={
        readMode ? null : (
          <button
            aria-label={isSaving ? "Saving..." : "Save note"}
            className={TOOLBAR_ACCENT_BUTTON_CLASS}
            disabled={isSaving}
            onClick={onSave}
            title={isSaving ? "Saving..." : "Save note"}
            type="button"
          >
            <Save aria-hidden="true" size={15} strokeWidth={2} />
          </button>
        )
      }
      error={error}
      status={readMode ? null : <span className="min-w-0 truncate text-sm text-text-muted">{statusText}</span>}
      toolbarControls={toolbarControls}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col" aria-labelledby="add-note-title">
      <h2 className="sr-only" id="add-note-title">
        New note
      </h2>
      {readMode ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <MarkdownPreview source={draftText} toolbar={toolbar} />
        </div>
      ) : (
        <MarkdownPane
          categoryNames={categories.map((category) => category.name)}
          disabled={isSaving}
          editorHandleRef={captureRef}
          mode="edit"
          onChange={onDraftTextChange}
          placeholder="Start writing your note in Markdown..."
          toolbar={toolbar}
          value={draftText}
          variant="workspace"
        />
      )}
    </div>
  );
}
