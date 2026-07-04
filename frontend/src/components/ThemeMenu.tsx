import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Moon, Sun } from "lucide-react";

import { getThemeMode, useTheme } from "../hooks/useTheme";
import { THEMES } from "./themes";

export function ThemeMenu() {
  const { theme, setTheme, toggleTheme, themesForMode } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const currentMode = getThemeMode(theme);
  const isDark = currentMode === "dark";
  const variants = themesForMode(currentMode);

  return (
    <div className="relative flex items-center" ref={containerRef}>
      <button
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        className="rounded p-1 text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
        onClick={toggleTheme}
        type="button"
      >
        {isDark ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
      </button>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label="Browse themes"
        className="rounded p-1 text-text-muted opacity-70 transition-colors hover:bg-surface hover:text-text-primary hover:opacity-100"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <ChevronDown size={12} strokeWidth={2} />
      </button>
      {isOpen ? (
        <div
          className="absolute right-0 top-full z-10 mt-1 min-w-[7.5rem] rounded-md bg-bg px-1 py-1 shadow-elevated"
          role="menu"
        >
          {variants.map((variantId) => {
            const meta = THEMES[variantId];
            const Icon = meta.icon;
            const isActive = variantId === theme;
            return (
              <button
                aria-checked={isActive}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-text-primary transition-colors hover:bg-surface-hover"
                key={variantId}
                onClick={() => {
                  setTheme(variantId);
                  setIsOpen(false);
                }}
                role="menuitemradio"
                type="button"
              >
                <Icon aria-hidden="true" size={13} strokeWidth={2} />
                <span className="flex-1">{meta.label}</span>
                {isActive ? <Check aria-hidden="true" size={13} strokeWidth={2} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
