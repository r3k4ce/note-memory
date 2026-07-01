import type { RefObject } from "react";

import type { AppMode } from "../hooks/useKeyboardShortcuts";
import type { AskResponse, Category } from "../types";
import { AddNote } from "./AddNote";
import { AskPanel } from "./AskPanel";

type CommandCenterProps = {
  mode: AppMode;

  captureRef: RefObject<HTMLTextAreaElement | null>;
  categories: Category[];
  draftCategoryId: number | null;
  draftText: string;
  isSaving: boolean;
  saveError: string | null;
  onDraftCategoryChange: (categoryId: number | null) => void;
  onDraftTextChange: (value: string) => void;
  onSave: () => void;

  askRef: RefObject<HTMLTextAreaElement | null>;
  onAskResult: (result: AskResponse | null) => void;
};

export function CommandCenter({
  mode,
  captureRef,
  categories,
  draftCategoryId,
  draftText,
  isSaving,
  saveError,
  onDraftCategoryChange,
  onDraftTextChange,
  onSave,
  askRef,
  onAskResult,
}: CommandCenterProps) {
  return (
    <section aria-label="Command center">
      {mode === "capture" && (
        <AddNote
          captureRef={captureRef}
          categories={categories}
          draftText={draftText}
          error={saveError}
          isSaving={isSaving}
          onCategoryChange={onDraftCategoryChange}
          onDraftTextChange={onDraftTextChange}
          onSave={onSave}
          selectedCategoryId={draftCategoryId}
        />
      )}

      {mode === "ask" && <AskPanel askRef={askRef} onResult={onAskResult} />}
    </section>
  );
}
