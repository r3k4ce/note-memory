import { useCallback, useEffect, useState } from "react";

export const THEME_IDS = ["dark", "forest", "light", "solarized"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export type ThemeMode = "dark" | "light";

export const DEFAULT_THEME: ThemeId = "dark";

export const THEME_MODE: Record<ThemeId, ThemeMode> = {
  dark: "dark",
  forest: "dark",
  light: "light",
  solarized: "light",
};

const DEFAULT_THEME_FOR_MODE: Record<ThemeMode, ThemeId> = {
  dark: "dark",
  light: "light",
};

const STORAGE_KEY = "theme";

const VALID_THEME_IDS: ReadonlySet<string> = new Set<string>(THEME_IDS);

function isValidThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && VALID_THEME_IDS.has(value);
}

function readStoredTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isValidThemeId(stored)) {
      return stored;
    }
  } catch {
    /* localStorage unavailable */
  }
  return DEFAULT_THEME;
}

function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* localStorage unavailable */
  }
}

export function getThemeMode(theme: ThemeId): ThemeMode {
  return THEME_MODE[theme];
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(() => readStoredTheme());

  const setTheme = useCallback((next: ThemeId) => {
    setThemeState(next);
    applyTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const currentMode = THEME_MODE[current];
      const nextMode: ThemeMode = currentMode === "dark" ? "light" : "dark";
      const next = DEFAULT_THEME_FOR_MODE[nextMode];
      applyTheme(next);
      return next;
    });
  }, []);

  const themesForMode = useCallback(
    (mode: ThemeMode): ThemeId[] => THEME_IDS.filter((id) => THEME_MODE[id] === mode),
    [],
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== STORAGE_KEY) return;
      if (isValidThemeId(event.newValue)) {
        setThemeState(event.newValue);
        document.documentElement.dataset.theme = event.newValue;
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return { theme, setTheme, toggleTheme, themesForMode } as const;
}