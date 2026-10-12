"use client";

import { useEffect, useRef, useState } from "react";
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

/** How long the copy confirmation stays before the block returns to idle. */
const CONFIRMATION_MS = 2000;

/** Preformatted code on the code surface, optionally with a copy-to-clipboard button. */
export function CodeBlock({ code, label, copyable = false, tone = "default", maxHeightClassName, className }: CodeBlockProps) {
  const [copy, setCopy] = useState<CopyState>("idle");
  const reset = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(reset.current), []);

  async function onCopy() {
    // Clear first so a repeated copy changes the live region and is announced again.
    clearTimeout(reset.current);
    setCopy("idle");
    let next: CopyState;
    try {
      await navigator.clipboard.writeText(code);
      next = "copied";
    } catch {
      next = "failed";
    }
    setCopy(next);
    reset.current = setTimeout(() => setCopy("idle"), CONFIRMATION_MS);
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
