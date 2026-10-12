import { isJudging } from "@/features/judgements/format";
import { STATUS_LABELS, STATUS_TONES, isActive } from "@/features/runs/format";
import type { Run } from "@/features/runs/types";
import type { BadgeTone } from "@/ui";

/** Judged runs under this score need a human look (the "warn" band starts here). */
export const REVIEW_BELOW = 60;

export type RunResultKind = "passed" | "review" | "failed" | "active" | "other";
export type RunResult = { kind: RunResultKind; label: string; tone: BadgeTone };

/** The list payload may carry `mustFailed` (the judgement's must criteria); older backends do not. */
type MaybeMust = Run & { mustFailed?: boolean | null };

/** The call itself broke (not the agent's answers): failed or interrupted. */
export function isFailedRun(run: Pick<Run, "status">): boolean {
  return run.status === "failed" || run.status === "interrupted";
}

/** Judged, and either a must criterion failed or the score is under 60. */
export function needsReview(run: MaybeMust): boolean {
  if (run.score === null || run.score === undefined) return false;
  return run.mustFailed === true || run.score < REVIEW_BELOW;
}

/** One word for how a run went: its call status, then its judgement. */
export function runResult(run: MaybeMust): RunResult {
  if (isActive(run.status)) return { kind: "active", label: STATUS_LABELS[run.status], tone: STATUS_TONES[run.status] };
  if (run.status === "failed") return { kind: "failed", label: "Failed", tone: "danger" };
  if (run.status === "interrupted") return { kind: "failed", label: "Interrupted", tone: "danger" };
  if (run.status === "cancelled") return { kind: "other", label: "Cancelled", tone: "muted" };
  if (needsReview(run)) return { kind: "review", label: "Needs review", tone: "evaluator" };
  if (run.score !== null && run.score !== undefined) return { kind: "passed", label: "Passed", tone: "success" };
  if (isJudging(run.judgementStatus)) return { kind: "other", label: "Judging…", tone: "muted" };
  if (run.judgementStatus === "failed") return { kind: "other", label: "Judge failed", tone: "muted" };
  return { kind: "other", label: "Not judged", tone: "muted" };
}
