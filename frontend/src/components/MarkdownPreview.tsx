import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownPreviewProps = {
  source: string;
};

export function MarkdownPreview({ source }: MarkdownPreviewProps) {
  return (
    <div className="prose prose-invert max-w-none overflow-x-auto prose-headings:text-text-primary prose-p:text-text-secondary prose-strong:text-text-primary prose-a:text-accent prose-blockquote:border-border-strong prose-blockquote:text-text-secondary prose-code:text-text-primary prose-pre:border prose-pre:border-border prose-pre:bg-bg prose-th:border-border prose-td:border-border">
      <Markdown remarkPlugins={[remarkGfm]}>{source}</Markdown>
    </div>
  );
}
