import { useEffect, type RefObject } from "react";

import type { MarkdownPaneHandle } from "../components/MarkdownPane";

export type AppMode = "capture" | "search" | "ask";

export const APP_SHORTCUTS: Record<
  AppMode,
  { aria: string; key: string; label: string }
> = {
  capture: { aria: "Alt+1", key: "1", label: "Alt+1" },
  search: { aria: "Alt+2", key: "2", label: "Alt+2" },
  ask: { aria: "Alt+3", key: "3", label: "Alt+3" },
};

type Refs = {
  captureRef: RefObject<MarkdownPaneHandle | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  askRef: RefObject<HTMLTextAreaElement | null>;
};

export function useKeyboardShortcuts(
  setMode: (mode: AppMode) => void,
  refs: Refs,
) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        const active = document.activeElement;
        if (active instanceof HTMLElement) {
          active.blur();
        }
        return;
      }

      if (!event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (event.key === APP_SHORTCUTS.search.key) {
        event.preventDefault();
        setMode("search");
        requestAnimationFrame(() => refs.searchRef.current?.focus());
      } else if (event.key === APP_SHORTCUTS.capture.key) {
        event.preventDefault();
        setMode("capture");
        requestAnimationFrame(() => refs.captureRef.current?.focus());
      } else if (event.key === APP_SHORTCUTS.ask.key) {
        event.preventDefault();
        setMode("ask");
        requestAnimationFrame(() => refs.askRef.current?.focus());
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setMode, refs.captureRef, refs.searchRef, refs.askRef]);
}
