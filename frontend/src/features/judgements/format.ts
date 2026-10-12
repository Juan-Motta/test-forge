import { SCORE_TEXT, scoreTone, type BadgeTone, type ScoreTone } from "@/ui";
import {
  ACTIVE_JUDGEMENT_STATUSES,
  CAPPING_FAILURE_TAGS,
  type ActiveJudgementStatus,
  type FailureTag,
  type SuggestionPriority,
  type TraceStats,
  type UnobservableReason,
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

const FAILURE_TAG_LABELS: Record<FailureTag, string> = {
  fabricated_information: "Fabricated information",
  wrong_information: "Wrong information",
  instruction_ignored: "Instruction ignored",
  unsafe_or_policy_violation: "Unsafe or policy violation",
  missing_information_request: "Missing information request",
  incomplete_task: "Incomplete task",
  off_topic: "Off topic",
  unclear_or_unnatural_speech: "Unclear or unnatural speech",
  cut_off_or_incomplete_reply: "Cut-off or incomplete reply",
  slow_response: "Slow response",
  tool_or_trace_error: "Tool or trace error",
};

/** Human label of a failure tag; an unknown tag is humanized (`some_new_tag` -> "Some new tag"). */
export function failureTagLabel(tag: string): string {
  if (Object.hasOwn(FAILURE_TAG_LABELS, tag)) return FAILURE_TAG_LABELS[tag as FailureTag];
  const words = tag.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : tag;
}

/** The band a capping failure tag limits a criterion to (judge/domain.py `CAP_BAND`). */
export const CAP_BAND = 2;

/** "Capped at 2/5 because of fabricated information and wrong information". */
export function cappedExplanation(tags: readonly string[]): string {
  const capping = tags.filter((tag) => (CAPPING_FAILURE_TAGS as readonly string[]).includes(tag));
  const reasons = capping.map((tag) => failureTagLabel(tag).toLowerCase());
  const base = `Capped at ${CAP_BAND}/5`;
  return reasons.length > 0 ? `${base} because of ${reasons.join(" and ")}` : base;
}

export const UNOBSERVABLE_REASON_LABELS: Record<UnobservableReason, string> = {
  traces_unavailable: "Traces unavailable",
  no_timing_data: "No timing data",
  judge_marked_unobservable: "The judge could not observe it",
  judge_omitted: "The judge gave no verdict",
};

/** "Incomplete task: 2 criteria". */
export function failureTagCountLabel(tag: string, count: number): string {
  return `${failureTagLabel(tag)}: ${count} ${count === 1 ? "criterion" : "criteria"}`;
}

const BAND_LABELS: Record<ScoreTone, string> = { good: "Good", warn: "Fair", bad: "Poor" };

/** Score band by the app-wide rule (`scoreTone`): >= 80 good, >= 60 fair, below that poor. */
export function scoreBand(score: number): { label: string; className: string } {
  const tone = scoreTone(score);
  return { label: BAND_LABELS[tone], className: SCORE_TEXT[tone] };
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
