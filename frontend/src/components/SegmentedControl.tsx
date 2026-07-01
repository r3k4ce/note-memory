import { PenLine, Search, Sparkles } from "lucide-react";

import type { AppMode } from "../hooks/useKeyboardShortcuts";

const MODES: { id: AppMode; label: string; Icon: typeof PenLine; shortcut: string }[] = [
  { id: "capture", label: "Capture", Icon: PenLine, shortcut: "⌘N" },
  { id: "search", label: "Search", Icon: Search, shortcut: "⌘K" },
  { id: "ask", label: "Ask", Icon: Sparkles, shortcut: "⌘I" },
];

type SegmentedControlProps = {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
};

export function SegmentedControl({ mode, onModeChange }: SegmentedControlProps) {
  return (
    <div className="inline-flex rounded-lg bg-slate-100 p-1" role="tablist">
      {MODES.map(({ id, label, Icon, shortcut }) => {
        const isActive = mode === id;

        return (
          <button
            aria-selected={isActive}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/15 ${
              isActive
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary hover:bg-white/50"
            }`}
            key={id}
            onClick={() => onModeChange(id)}
            role="tab"
            title={`${label} (${shortcut})`}
            type="button"
          >
            <Icon size={15} strokeWidth={2} />
            <span className="hidden sm:inline">{label}</span>
            <kbd className="ml-1 hidden rounded bg-slate-100 px-1 py-0.5 text-[10px] font-medium text-text-caption sm:inline">
              {shortcut}
            </kbd>
          </button>
        );
      })}
    </div>
  );
}
