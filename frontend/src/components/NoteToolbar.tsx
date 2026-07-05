import type { ReactNode } from "react";

type NoteToolbarProps = {
  actions?: ReactNode;
  error?: string | null;
  status?: ReactNode;
  toolbarControls: ReactNode;
};

export const TOOLBAR_BUTTON_CLASS =
  "inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40";

export const TOOLBAR_ACCENT_BUTTON_CLASS =
  "inline-flex h-6 w-6 items-center justify-center rounded-md bg-accent text-black transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-not-allowed disabled:opacity-40";

export function NoteToolbar({ actions, error, status, toolbarControls }: NoteToolbarProps) {
  return (
    <div className="relative shrink-0">
      <div
        aria-label="Note toolbar"
        className="flex min-h-8 items-center justify-between gap-3 px-3 py-1"
        role="toolbar"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">{status}</div>
        <div className="flex shrink-0 items-center justify-end gap-1">
          {actions}
          {toolbarControls}
        </div>
      </div>
      {error ? (
        <div className="absolute left-3 top-full z-20 max-w-[min(36rem,calc(100%-1.5rem))] rounded-md border border-error/20 bg-bg px-2.5 py-1.5 text-xs text-error shadow-elevated">
          {error}
        </div>
      ) : null}
    </div>
  );
}
