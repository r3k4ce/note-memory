import { CloudSun, Moon, Sun, TreePine, type LucideIcon } from "lucide-react";

import type { ThemeId } from "../hooks/useTheme";

type ThemeMeta = {
  label: string;
  icon: LucideIcon;
};

export const THEMES: Record<ThemeId, ThemeMeta> = {
  dark: { label: "Cocoa", icon: Moon },
  forest: { label: "Matcha", icon: TreePine },
  light: { label: "Biscuit", icon: Sun },
  solarized: { label: "Honey", icon: CloudSun },
};