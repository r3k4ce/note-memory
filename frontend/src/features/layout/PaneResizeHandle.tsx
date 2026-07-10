import type { PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";

type PaneResizeHandleProps = {
  className?: string;
  left: number;
  label: string;
  maxWidth: number;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  snapped?: boolean;
  width: number;
};

export function PaneResizeHandle({
  className = "flex",
  left,
  label,
  maxWidth,
  onResizeStart,
  snapped = false,
  width,
}: PaneResizeHandleProps) {
  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={maxWidth}
      aria-valuemin={0}
      aria-valuenow={width}
      className={`resize-handle-grip group absolute top-1/2 z-20 h-8 w-3.5 shrink-0 -translate-x-1/2 -translate-y-1/2 cursor-col-resize items-center justify-center bg-bg text-text-muted transition-colors hover:text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 ${
        snapped ? "resize-handle-grip-snapped" : ""
      } ${className}`}
      onPointerDown={onResizeStart}
      role="separator"
      style={{ left }}
      tabIndex={0}
    >
      <GripVertical aria-hidden="true" size={13} strokeWidth={1.75} />
    </div>
  );
}
