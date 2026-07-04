import { Moon, Sun } from "lucide-react";
import type { Theme } from "../hooks/useTheme";

type ThemeToggleProps = {
  theme: Theme;
  onToggle: () => void;
};

export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const isDark = theme === "dark";

  return (
    <button
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="rounded p-1 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
      onClick={onToggle}
      type="button"
    >
      {isDark ? <Sun size={14} strokeWidth={2} /> : <Moon size={14} strokeWidth={2} />}
    </button>
  );
}
