import type { BadgeTone } from "@/ui";
import {
  ACTIVE_JUDGEMENT_STATUSES,
  type ActiveJudgementStatus,
  type SuggestionPriority,
  type TraceStats,
  type Verdict,
} from "./types";

export function isJudging(status: string | null | undefined): status is ActiveJudgementStatus {
  return (ACTIVE_JUDGEMENT_STATUSES as readonly string[]).includes(status ?? "");
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  pass: "Pass",
  partial: "Partial",
  fail: "Fail",
  not_observable: "Not observable",
};

export const VERDICT_TONES: Record<Verdict, BadgeTone> = {
  pass: "success",
  partial: "evaluator",
  fail: "danger",
  not_observable: "neutral",
};

export const PRIORITY_TONES: Record<SuggestionPriority, BadgeTone> = {
  high: "danger",
  medium: "evaluator",
  low: "neutral",
};

/** Score band: >= 80 good, >= 50 fair, below that poor. */
export function scoreBand(score: number): { label: string; className: string } {
  if (score >= 80) return { label: "Good", className: "text-success-fg" };
  if (score >= 50) return { label: "Fair", className: "text-evaluator-fg" };
  return { label: "Poor", className: "text-danger-fg" };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** "3 traces · 41 observations · 1 error · gpt-x, gpt-y" from the digest stats. */
export function traceStatsLine(stats: TraceStats): string {
  const parts = [
    plural(stats.traceCount ?? 0, "trace"),
    plural(stats.observationCount ?? 0, "observation"),
    plural(stats.errorCount ?? 0, "error"),
  ];
  if (stats.models && stats.models.length > 0) parts.push(stats.models.join(", "));
  return parts.join(" · ");
}

/** "2m 05s" for an elapsed time. */
export function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return minutes > 0 ? `${minutes}m ${rest}s` : `${seconds % 60}s`;
}

/** Element id of a transcript turn (`A3`, `C2`) in the run report, or null for other refs. */
export function turnAnchorId(ref: string): string | null {
  return /^[AC]\d+$/.test(ref.trim()) ? `turn-${ref.trim()}` : null;
}

/** File name of a downloaded brief: `judge-brief-<first 8 chars of the run id>.md`. */
export function briefFileName(runId: string): string {
  return `judge-brief-${runId.slice(0, 8)}.md`;
}
