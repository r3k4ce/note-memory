import { PenLine, Search, Sparkles } from "lucide-react";

import { APP_SHORTCUTS, type AppMode } from "../hooks/useKeyboardShortcuts";

const MODES: { id: AppMode; label: string; Icon: typeof PenLine }[] = [
  { id: "capture", label: "Capture", Icon: PenLine },
  { id: "search", label: "Search", Icon: Search },
  { id: "ask", label: "Ask", Icon: Sparkles },
];

type SegmentedControlProps = {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
};

export function SegmentedControl({ mode, onModeChange }: SegmentedControlProps) {
  return (
    <div className="flex items-center gap-0.5" role="tablist">
      {MODES.map(({ id, label, Icon }) => {
        const isActive = mode === id;
        const shortcut = APP_SHORTCUTS[id];

        return (
          <button
            aria-keyshortcuts={shortcut.aria}
            aria-selected={isActive}
            className={`group flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
              isActive
                ? "bg-surface-raised text-text-primary"
                : "text-text-muted hover:text-text-secondary hover:bg-surface-hover"
            }`}
            key={id}
            onClick={() => onModeChange(id)}
            role="tab"
            title={`${label} (${shortcut.label})`}
            type="button"
          >
            <Icon
              size={14}
              strokeWidth={2}
              className={isActive ? "text-accent" : undefined}
            />
            <span className="hidden sm:inline">{label}</span>
            <kbd className="hidden rounded bg-bg px-1 py-0.5 text-[10px] font-medium text-text-muted md:inline">
              {shortcut.label}
            </kbd>
          </button>
        );
      })}
    </div>
  );
}
