import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "neutral" | "agent" | "evaluator" | "success" | "danger" | "muted" | "outline";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-chip text-fg",
  agent: "bg-agent/15 text-agent",
  evaluator: "bg-evaluator/15 text-evaluator-fg",
  success: "bg-success/15 text-success-fg",
  danger: "bg-danger/15 text-danger-fg",
  /** Quiet state (queued, low severity). */
  muted: "bg-tag text-muted",
  /** Bordered, no fill (secondary metadata). */
  outline: "border border-field-line text-muted",
};

type BadgeProps = {
  tone?: BadgeTone;
  mono?: boolean;
  /** "sm" (default) for lists and tables; "md" adds room for header rows next to buttons. */
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
};

/** Small status chip (pill). */
export function Badge({ tone = "neutral", mono = false, size = "sm", className, children }: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full text-xs font-medium",
        size === "md" ? "px-3 py-1" : "px-2.5 py-0.5",
        mono && "font-mono",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
