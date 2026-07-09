import type { ReactNode, Ref } from "react";

type MarkdownPageSurfaceProps = {
  children: ReactNode;
  surfaceRef?: Ref<HTMLDivElement>;
  toolbar?: ReactNode;
};

export function MarkdownPageSurface({ children, surfaceRef, toolbar }: MarkdownPageSurfaceProps) {
  return (
    <div className="workspace-page-shell markdown-page-surface" ref={surfaceRef}>
      {toolbar}
      <div className="markdown-page-side-fades" aria-hidden="true" />
      {children}
    </div>
  );
}
