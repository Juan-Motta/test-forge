import type { Translator } from "@/lib/i18n";
import { SCORE_TEXT, scoreTone, type BadgeTone, type ScoreTone } from "@/ui";
import {
  ACTIVE_JUDGEMENT_STATUSES,
  CAPPING_FAILURE_TAGS,
  type ActiveJudgementStatus,
  type EvidenceSource,
  type FailureTag,
  type SuggestionArea,
  type SuggestionPriority,
  type TraceStats,
  type UnobservableReason,
  type Verdict,
} from "./types";

export function isJudging(status: string | null | undefined): status is ActiveJudgementStatus {
  return (ACTIVE_JUDGEMENT_STATUSES as readonly string[]).includes(status ?? "");
}

export function verdictLabel(t: Translator, verdict: Verdict): string {
  return t(`judgement.verdict.${verdict}`);
}

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

const FAILURE_TAGS: readonly FailureTag[] = [
  ...CAPPING_FAILURE_TAGS,
  "missing_information_request",
  "incomplete_task",
  "off_topic",
  "unclear_or_unnatural_speech",
  "cut_off_or_incomplete_reply",
  "slow_response",
  "tool_or_trace_error",
];

/** `some_new_value` -> "some new value": a judge value the app has no words for, still readable. */
function words(value: string): string {
  return value.replace(/[_-]+/g, " ").trim().toLowerCase();
}

/** `some_new_value` -> "Some new value". */
function humanize(value: string): string {
  const text = words(value);
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : value;
}

/** Human label of a failure tag; an unknown tag is humanized (`some_new_tag` -> "Some new tag"). */
export function failureTagLabel(t: Translator, tag: string): string {
  if ((FAILURE_TAGS as readonly string[]).includes(tag)) return t(`judgement.tag.${tag as FailureTag}`);
  return humanize(tag);
}

const SUGGESTION_AREAS: readonly SuggestionArea[] = ["prompt", "tools", "flow", "latency", "voice", "other"];
const SUGGESTION_PRIORITIES: readonly SuggestionPriority[] = ["high", "medium", "low"];
const EVIDENCE_SOURCES: readonly EvidenceSource[] = ["transcript", "trace", "timing"];

/*
 * The judge (an LLM) writes these values; one the app does not know is shown humanized rather
 * than looked up as a message key that does not exist.
 */

/** "Prompt", "Latency", …; an unknown area is humanized. */
export function suggestionAreaLabel(t: Translator, area: string): string {
  return (SUGGESTION_AREAS as readonly string[]).includes(area) ? t(`report.area.${area as SuggestionArea}`) : humanize(area);
}

/** "High priority", …; an unknown priority is humanized. */
export function suggestionPriorityLabel(t: Translator, priority: string): string {
  return (SUGGESTION_PRIORITIES as readonly string[]).includes(priority)
    ? t(`report.priority.${priority as SuggestionPriority}`)
    : humanize(priority);
}

/** "transcript", "trace", "timing" (lowercase, read inside a sentence); an unknown source in plain words. */
export function evidenceSourceLabel(t: Translator, source: string): string {
  return (EVIDENCE_SOURCES as readonly string[]).includes(source) ? t(`report.source.${source as EvidenceSource}`) : words(source);
}

/** The band a capping failure tag limits a criterion to (judge/domain.py `CAP_BAND`). */
export const CAP_BAND = 2;

/** "Capped at 2/5 because of fabricated information and wrong information". */
export function cappedExplanation(t: Translator, tags: readonly string[]): string {
  const capping = tags.filter((tag) => (CAPPING_FAILURE_TAGS as readonly string[]).includes(tag));
  const reasons = capping.map((tag) => failureTagLabel(t, tag).toLowerCase());
  if (reasons.length === 0) return t("judgement.capped", { band: CAP_BAND });
  return t("judgement.cappedBecause", { band: CAP_BAND, reasons: reasons.join(t("judgement.and")) });
}

export function unobservableReasonLabel(t: Translator, reason: string): string {
  const known: readonly string[] = ["traces_unavailable", "no_timing_data", "judge_marked_unobservable", "judge_omitted"];
  return known.includes(reason) ? t(`judgement.unobservable.${reason as UnobservableReason}`) : reason;
}

/** "Incomplete task: 2 criteria". */
export function failureTagCountLabel(t: Translator, tag: string, count: number): string {
  return t.plural("judgement.tagCount", count, { tag: failureTagLabel(t, tag) });
}

const BAND_KEYS = { good: "judgement.band.good", warn: "judgement.band.fair", bad: "judgement.band.poor" } as const;

/** Score band by the app-wide rule (`scoreTone`): >= 80 good, >= 60 fair, below that poor. */
export function scoreBand(t: Translator, score: number): { label: string; className: string } {
  const tone: ScoreTone = scoreTone(score);
  return { label: t(BAND_KEYS[tone]), className: SCORE_TEXT[tone] };
}

/** "3 traces · 41 observations · 1 error · gpt-x, gpt-y" from the digest stats. */
export function traceStatsLine(t: Translator, stats: TraceStats): string {
  const parts = [
    t.plural("judgement.traces", stats.traceCount ?? 0),
    t.plural("judgement.observations", stats.observationCount ?? 0),
    t.plural("judgement.errors", stats.errorCount ?? 0),
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
