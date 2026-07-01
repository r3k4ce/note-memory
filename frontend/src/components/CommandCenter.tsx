import type { RefObject } from "react";

import type { AppMode } from "../hooks/useKeyboardShortcuts";
import { AddNote } from "./AddNote";
import { AskPanel } from "./AskPanel";

type CommandCenterProps = {
  mode: AppMode;

  captureRef: RefObject<HTMLTextAreaElement | null>;
  draftText: string;
  isSaving: boolean;
  saveError: string | null;
  onDraftTextChange: (value: string) => void;
  onSave: () => void;

  askRef: RefObject<HTMLTextAreaElement | null>;
  onAskResult: (result: import("../types").AskResponse | null) => void;
};

export function CommandCenter({
  mode,
  captureRef,
  draftText,
  isSaving,
  saveError,
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
          draftText={draftText}
          error={saveError}
          isSaving={isSaving}
          onDraftTextChange={onDraftTextChange}
          onSave={onSave}
        />
      )}

      {mode === "ask" && <AskPanel askRef={askRef} onResult={onAskResult} />}
    </section>
  );
}
