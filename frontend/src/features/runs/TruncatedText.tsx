import { cn } from "@/ui";

/** A single-line, ellipsized text that keeps its full text in a tooltip. */
export function TruncatedText({ text, className }: { text: string; className?: string }) {
  return (
    <span title={text} className={cn("block truncate", className)}>
      {text}
    </span>
  );
}
