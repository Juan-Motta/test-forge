import type { ReactNode } from "react";
import { cn } from "./cn";

export type ProgressTone = "success" | "evaluator" | "agent" | "danger" | "idle" | "muted";

const TONE: Record<ProgressTone, string> = {
  success: "bg-success",
  evaluator: "bg-evaluator",
  agent: "bg-agent",
  danger: "bg-danger",
  idle: "bg-idle",
  muted: "bg-chip",
};

export type ProgressSegment = { key: string; label: string; value: number; tone: ProgressTone };

type StackedProgressProps = {
  /** Prefix of the bar's text alternative ("Batch progress: 2 completed, …"). */
  label: string;
  segments: ProgressSegment[];
  /** Extra legend text after the counts (e.g. "Concurrency 3 · 6 runs total"). */
  extra?: ReactNode;
  className?: string;
};

/** 8px bar split into proportional segments, with a counted legend. */
export function StackedProgress({ label, segments, extra, className }: StackedProgressProps) {
  const summary = segments.map((segment) => `${segment.value} ${segment.label}`).join(", ");

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <div role="img" aria-label={`${label}: ${summary}`} className="flex h-2 gap-0.5 overflow-hidden rounded bg-chip">
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <span key={segment.key} data-segment className={TONE[segment.tone]} style={{ flexGrow: segment.value }} />
          ))}
      </div>
      <div className="flex flex-wrap gap-5 text-[13px] text-muted">
        {/* The counts repeat the bar's text alternative, so only the extra text is read. */}
        {segments.map((segment) => (
          <span key={segment.key} aria-hidden="true" className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-[2px]", TONE[segment.tone])} />
            {`${segment.value} ${segment.label}`}
          </span>
        ))}
        {extra ? <span>{extra}</span> : null}
      </div>
    </div>
  );
}
