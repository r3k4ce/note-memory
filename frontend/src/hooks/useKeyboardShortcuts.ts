import { useEffect, type RefObject } from "react";

export type AppMode = "capture" | "search" | "ask";

type Refs = {
  captureRef: RefObject<HTMLTextAreaElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  askRef: RefObject<HTMLTextAreaElement | null>;
};

export function useKeyboardShortcuts(
  setMode: (mode: AppMode) => void,
  refs: Refs,
) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const isModifier = event.metaKey || event.ctrlKey;

      if (!isModifier) {
        if (event.key === "Escape") {
          const active = document.activeElement;
          if (active instanceof HTMLElement) {
            active.blur();
          }
        }
        return;
      }

      if (event.key === "k") {
        event.preventDefault();
        setMode("search");
        requestAnimationFrame(() => refs.searchRef.current?.focus());
      } else if (event.key === "n") {
        event.preventDefault();
        setMode("capture");
        requestAnimationFrame(() => refs.captureRef.current?.focus());
      } else if (event.key === "i") {
        event.preventDefault();
        setMode("ask");
        requestAnimationFrame(() => refs.askRef.current?.focus());
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [setMode, refs.captureRef, refs.searchRef, refs.askRef]);
}
