"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReplyFormat } from "@/lib/browser/reply-format";

type MarkdownNode = { type: string; children?: MarkdownNode[] };

/**
 * Remark plugin: HTML in a reply becomes plain text, so it is shown as typed (`<div>`, a
 * tag-like placeholder) and never parsed or run.
 */
function htmlAsText() {
  const walk = (node: MarkdownNode) => {
    if (node.type === "html") node.type = "text";
    node.children?.forEach(walk);
  };
  return walk;
}

/** Markdown elements styled for a chat bubble (compact spacing, the bubble's own text size). */
const COMPONENTS: Components = {
  p: ({ children }) => <p className="[&:not(:first-child)]:mt-2">{children}</p>,
  ul: ({ children }) => <ul className="mt-2 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="mt-2 list-decimal space-y-0.5 pl-5">{children}</ol>,
  h1: ({ children }) => <p className="mt-2 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mt-2 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mt-2 font-semibold">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-chip px-1 py-0.5 font-mono text-[12px]">{children}</code>,
  pre: ({ children }) => <pre className="mt-2 overflow-x-auto rounded-lg bg-chip p-2.5 [&>code]:bg-transparent [&>code]:p-0">{children}</pre>,
  blockquote: ({ children }) => <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-muted">{children}</blockquote>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline">
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="mt-2 overflow-x-auto">
      <table className="border-collapse text-left text-[13px] [&_td]:border [&_td]:border-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-line [&_th]:px-2 [&_th]:py-1">
        {children}
      </table>
    </div>
  ),
};

/**
 * A text agent's reply: rendered as Markdown (GitHub flavour; HTML in it is shown as text, never
 * run) or, when the Settings preference says Raw, exactly as the agent sent it.
 */
export function AgentText({ text }: { text: string }) {
  const [format] = useReplyFormat();
  if (format === "raw") {
    return <p className="text-sm leading-normal break-words whitespace-pre-wrap text-body">{text}</p>;
  }
  return (
    <div className="text-sm leading-normal break-words text-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, htmlAsText]} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
