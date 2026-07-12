import { Moon, Sun } from "lucide-react";

import { getThemeMode, useTheme } from "../hooks/useTheme";
import { THEMES } from "./themes";

export function AppearanceSettings() {
  const { theme, setTheme, toggleTheme, themesForMode } = useTheme();
  const currentMode = getThemeMode(theme);
  const isDark = currentMode === "dark";

  return (
    <section aria-labelledby="appearance-settings-title">
      <div className="flex items-center gap-3">
        <div>
          <h3 className="font-semibold text-text-primary" id="appearance-settings-title">Appearance</h3>
          <p className="mt-1 text-xs text-text-muted">Choose how Notebun looks.</p>
        </div>
        <button
          aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          className="ml-auto inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          onClick={toggleTheme}
          type="button"
        >
          {isDark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
          {isDark ? "Light" : "Dark"}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {themesForMode(currentMode).map((variantId) => {
          const meta = THEMES[variantId];
          const Icon = meta.icon;
          return (
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm transition-colors ${variantId === theme ? "border-accent bg-accent-muted text-accent" : "border-border text-text-secondary hover:bg-surface-hover"}`}
              key={variantId}
            >
              <input
                checked={variantId === theme}
                className="sr-only"
                name="theme-variant"
                onChange={() => setTheme(variantId)}
                type="radio"
              />
              <Icon size={15} aria-hidden="true" />
              {meta.label}
            </label>
          );
        })}
      </div>
    </section>
  );
}
