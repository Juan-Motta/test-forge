import { isJudging } from "@/features/judgements/format";
import { STATUS_TONES, isActive, statusLabel } from "@/features/runs/format";
import type { Run } from "@/features/runs/types";
import type { Translator } from "@/lib/i18n";
import type { BadgeTone } from "@/ui";

/** Judged runs under this score need a human look (the "warn" band starts here). */
export const REVIEW_BELOW = 60;

export type RunResultKind = "passed" | "review" | "failed" | "active" | "other";
export type RunResult = { kind: RunResultKind; label: string; tone: BadgeTone };

/** The call itself broke (not the agent's answers): failed or interrupted. */
export function isFailedRun(run: Pick<Run, "status">): boolean {
  return run.status === "failed" || run.status === "interrupted";
}

type Judged = Pick<Run, "judgementStatus" | "score" | "mustFailed">;

/** Whether the run's judgement completed (its score and must flag are final). */
export function isJudged(run: Pick<Run, "judgementStatus">): boolean {
  return run.judgementStatus === "completed";
}

/** Judged, and either a must criterion failed or the score is under 60. */
export function needsReview(run: Judged): boolean {
  if (!isJudged(run)) return false;
  if (run.mustFailed === true) return true;
  return run.score !== null && run.score !== undefined && run.score < REVIEW_BELOW;
}

/** One word for how a run went: its call status, then its judgement. */
export function runResult(t: Translator, run: Run): RunResult {
  if (isActive(run.status)) return { kind: "active", label: statusLabel(t, run.status), tone: STATUS_TONES[run.status] };
  if (run.status === "failed") return { kind: "failed", label: t("runs.status.failed"), tone: "danger" };
  if (run.status === "interrupted") return { kind: "failed", label: t("runs.status.interrupted"), tone: "danger" };
  if (run.status === "cancelled") return { kind: "other", label: t("runs.status.cancelled"), tone: "muted" };
  if (needsReview(run)) return { kind: "review", label: t("runs.result.review"), tone: "evaluator" };
  if (run.score !== null && run.score !== undefined) return { kind: "passed", label: t("runs.result.passed"), tone: "success" };
  if (isJudging(run.judgementStatus)) return { kind: "other", label: t("runs.result.judging"), tone: "muted" };
  if (run.judgementStatus === "failed") return { kind: "other", label: t("runs.result.judgeFailed"), tone: "muted" };
  return { kind: "other", label: t("runs.result.notJudged"), tone: "muted" };
}
