import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownPreviewProps = {
  source: string;
};

export function MarkdownPreview({ source }: MarkdownPreviewProps) {
  return (
    <div className="note-preview px-6 py-5 prose max-w-none overflow-x-auto prose-headings:text-text-primary prose-headings:font-semibold prose-p:text-text-secondary prose-strong:text-text-primary prose-a:text-accent prose-a:underline prose-blockquote:border-border-strong prose-blockquote:text-text-secondary prose-blockquote:not-italic prose-code:text-text-primary prose-code:rounded prose-code:bg-surface-raised prose-code:px-1 prose-code:py-0.5 prose-pre:border prose-pre:border-border prose-pre:bg-bg prose-pre:rounded-md prose-ul:text-text-secondary prose-ol:text-text-secondary prose-hr:border-border prose-th:border-border prose-td:border-border">
      <Markdown remarkPlugins={[remarkGfm]}>{source}</Markdown>
    </div>
  );
}
