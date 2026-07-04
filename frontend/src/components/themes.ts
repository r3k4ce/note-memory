import { CloudSun, Moon, Sun, TreePine, type LucideIcon } from "lucide-react";

import type { ThemeId } from "../hooks/useTheme";

type ThemeMeta = {
  label: string;
  icon: LucideIcon;
};

export const THEMES: Record<ThemeId, ThemeMeta> = {
  dark: { label: "Midnight", icon: Moon },
  forest: { label: "Forest", icon: TreePine },
  light: { label: "Daylight", icon: Sun },
  solarized: { label: "Solarized", icon: CloudSun },
};