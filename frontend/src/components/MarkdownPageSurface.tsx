import type { ReactNode } from "react";

type MarkdownPageSurfaceProps = {
  children: ReactNode;
  toolbar?: ReactNode;
};

export function MarkdownPageSurface({ children, toolbar }: MarkdownPageSurfaceProps) {
  return (
    <div className="workspace-page-shell markdown-page-surface">
      {toolbar}
      {children}
    </div>
  );
}
