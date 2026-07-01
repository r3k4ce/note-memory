import { PenLine, Search, Sparkles } from "lucide-react";

import type { AppMode } from "../hooks/useKeyboardShortcuts";

const MODES: { id: AppMode; label: string; Icon: typeof PenLine; shortcut: string }[] = [
  { id: "capture", label: "Capture", Icon: PenLine, shortcut: "N" },
  { id: "search", label: "Search", Icon: Search, shortcut: "K" },
  { id: "ask", label: "Ask", Icon: Sparkles, shortcut: "I" },
];

type SegmentedControlProps = {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
};

export function SegmentedControl({ mode, onModeChange }: SegmentedControlProps) {
  return (
    <div className="flex items-center gap-0.5" role="tablist">
      {MODES.map(({ id, label, Icon, shortcut }) => {
        const isActive = mode === id;

        return (
          <button
            aria-selected={isActive}
            className={`group flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              isActive
                ? "bg-surface-raised text-text-primary"
                : "text-text-muted hover:text-text-secondary hover:bg-surface-hover"
            }`}
            key={id}
            onClick={() => onModeChange(id)}
            role="tab"
            title={`${label} (⌘${shortcut})`}
            type="button"
          >
            <Icon
              size={14}
              strokeWidth={2}
              className={isActive ? "text-accent" : undefined}
            />
            <span className="hidden sm:inline">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
