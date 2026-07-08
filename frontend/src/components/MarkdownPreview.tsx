import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ReactNode, Ref } from "react";

import { MarkdownPageSurface } from "./MarkdownPageSurface";

type MarkdownPreviewProps = {
  source: string;
  surfaceRef?: Ref<HTMLDivElement>;
  toolbar?: ReactNode;
};

function splitLeadingFrontmatter(source: string): { body: string; frontmatter: string | null } {
  const normalizedSource = source.replace(/\r\n/g, "\n");
  if (!normalizedSource.startsWith("---\n")) {
    return { body: source, frontmatter: null };
  }

  const closingMarkerIndex = normalizedSource.indexOf("\n---", 4);
  if (closingMarkerIndex === -1) {
    return { body: source, frontmatter: null };
  }

  const closingMarkerEnd = normalizedSource.indexOf("\n", closingMarkerIndex + 1);
  const frontmatterEnd = closingMarkerEnd === -1 ? normalizedSource.length : closingMarkerEnd;
  const bodyStart = closingMarkerEnd === -1 ? normalizedSource.length : closingMarkerEnd + 1;

  return {
    body: normalizedSource.slice(bodyStart).replace(/^\n/, ""),
    frontmatter: normalizedSource.slice(0, frontmatterEnd),
  };
}

export function MarkdownPreview({ source, surfaceRef, toolbar }: MarkdownPreviewProps) {
  const { body, frontmatter } = splitLeadingFrontmatter(source);

  return (
    <MarkdownPageSurface surfaceRef={surfaceRef} toolbar={toolbar}>
      <div className="note-preview prose max-w-none overflow-x-auto prose-headings:text-text-primary prose-headings:font-semibold prose-p:text-text-secondary prose-strong:text-text-primary prose-a:text-accent prose-a:underline prose-blockquote:border-accent-muted prose-blockquote:text-text-secondary prose-blockquote:not-italic prose-code:text-text-primary prose-code:rounded prose-code:bg-surface-raised prose-code:px-1 prose-code:py-0.5 prose-pre:border prose-pre:border-border prose-pre:bg-bg prose-pre:rounded-md prose-ul:text-text-secondary prose-ol:text-text-secondary prose-hr:border-border prose-th:border-border">
        {frontmatter ? (
          <pre className="note-frontmatter">
            <code>{frontmatter}</code>
          </pre>
        ) : null}
        <Markdown remarkPlugins={[remarkGfm]}>{body}</Markdown>
      </div>
    </MarkdownPageSurface>
  );
}
