import { X } from "lucide-react";
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";

import { MemorySettings } from "./MemoryManager";
import { AppearanceSettings } from "./ThemeMenu";

type SettingsDialogProps = {
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
};

export function SettingsDialog({ onClose, triggerRef }: SettingsDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dismiss = useCallback(() => {
    onClose();
    triggerRef.current?.focus();
  }, [onClose, triggerRef]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [dismiss]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6"
      data-testid="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        aria-labelledby="settings-title"
        aria-modal="true"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-elevated"
        role="dialog"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-text-primary" id="settings-title">Settings</h2>
          <button
            aria-label="Close settings"
            className="ml-auto rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"
            onClick={dismiss}
            ref={closeButtonRef}
            type="button"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <div className="min-h-0 space-y-6 overflow-y-auto px-5 py-5">
          <AppearanceSettings />
          <MemorySettings />
        </div>
      </div>
    </div>,
    document.body,
  );
}
