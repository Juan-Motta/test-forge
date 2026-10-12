"use client";

import { useState } from "react";
import { cn } from "./cn";
import { IconButton } from "./IconButton";
import { CheckIcon, CopyIcon } from "./icons";

type CodeBlockProps = {
  code: string;
  /** Accessible name of the (scrollable, focusable) block. */
  label: string;
  /** Adds a copy button and a polite confirmation. */
  copyable?: boolean;
  /** Green command text (the design's install/curl snippets) instead of body text. */
  tone?: "default" | "command";
  /** Tailwind max-height class (e.g. "max-h-[300px]"); the block scrolls past it. */
  maxHeightClassName?: string;
  className?: string;
};

type CopyState = "idle" | "copied" | "failed";

/** Preformatted code on the code surface, optionally with a copy-to-clipboard button. */
export function CodeBlock({ code, label, copyable = false, tone = "default", maxHeightClassName, className }: CodeBlockProps) {
  const [copy, setCopy] = useState<CopyState>("idle");

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <div className={cn("relative", className)}>
      <pre
        role="region"
        aria-label={label}
        tabIndex={0}
        className={cn(
          "m-0 overflow-auto rounded-[10px] border border-line bg-code p-4 font-mono text-xs leading-[1.65] whitespace-pre-wrap",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evaluator",
          tone === "command" ? "text-code-fg" : "text-body",
          copyable && "pr-14",
          maxHeightClassName,
        )}
      >
        {code}
      </pre>
      {copyable ? (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-2">
          <span role="status" className="text-xs text-dim">
            {copy === "copied" ? "Copied" : copy === "failed" ? "Copy failed" : ""}
          </span>
          <IconButton
            label="Copy"
            icon={copy === "copied" ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            onClick={() => void onCopy()}
          />
        </div>
      ) : null}
    </div>
  );
}
