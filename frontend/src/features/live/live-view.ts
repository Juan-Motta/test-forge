import { clock, endReasonLabel, isActive, latency, median, runDurationMs, statusLabel } from "@/features/runs/format";
import { runKind } from "@/features/runs/kind";
import type { Batch, Run, RunSnapshot } from "@/features/runs/types";
import { createTranslator, type Translator } from "@/lib/i18n";
import { CLOSE_FORBIDDEN_ORIGIN, CLOSE_NOT_FOUND, CLOSE_UNAUTHENTICATED } from "@/lib/live/connection";
import type { BadgeTone, ProgressSegment } from "@/ui";
import type { LiveRunState } from "./live-state";

/** What the focused run's stream says about its turns, shown on its session card. */
export type SessionStats = { turns: number; p50Ms: number | null };

export type LiveMetrics = {
  avgLatencyMs: number | null;
  slowestMs: number | null;
  p50Ms: number | null;
  /** Transcript lines so far (agent and evaluator). */
  turns: number;
  interruptions: number;
  confirmed: number;
};

/** An agent turn slower than this is flagged. */
export const SLOW_TURN_MS = 2000;

/** The call so far, from the live stream: agent latencies, turns and interruptions. */
export function liveMetrics(state: Pick<LiveRunState, "entries" | "turns" | "interruptions">): LiveMetrics {
  const latencies = state.turns.map((turn) => turn.latencyMs).filter((value): value is number => value !== null);
  return {
    avgLatencyMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : null,
    slowestMs: latencies.length ? Math.max(...latencies) : null,
    p50Ms: median(latencies),
    turns: state.entries.length,
    interruptions: state.interruptions.length,
    confirmed: state.interruptions.filter((item) => item.confirmed).length,
  };
}

/** The evaluator's plan: the scenario goal, then the criteria the judge will check. */
export function evaluatorGoals(snapshot: RunSnapshot | undefined): string[] {
  const scenario = snapshot?.scenario as (RunSnapshot["scenario"] & { criteria?: { text?: unknown }[] }) | undefined;
  if (!scenario) return [];
  const criteria = Array.isArray(scenario.criteria) ? scenario.criteria : [];
  return [scenario.goal, ...criteria.map((criterion) => criterion?.text)].filter(
    (text): text is string => typeof text === "string" && text.trim() !== "",
  );
}

const EVALUATOR_LABELS = { pipeline: "runs.evaluator.pipeline", realtime: "runs.evaluator.realtime" } as const;

/** "Realtime evaluator · gpt-realtime-2.1", or null on runs launched before the choice existed. */
export function evaluatorChip(t: Translator, snapshot: RunSnapshot | undefined): string | null {
  const mode = snapshot?.scenario?.evaluatorMode;
  if (!mode) return null;
  const model = mode === "realtime" ? snapshot?.scenario?.realtimeModel : undefined;
  return [t(EVALUATOR_LABELS[mode]), model].filter(Boolean).join(" · ");
}

/** The status chip of a session card. */
export function sessionChip(t: Translator, run: Pick<Run, "status" | "score">): { label: string; tone: BadgeTone } {
  switch (run.status) {
    case "running":
      return { label: t("runs.live"), tone: "danger" };
    case "connecting":
      return { label: statusLabel(t, "connecting"), tone: "agent" };
    case "queued":
      return { label: statusLabel(t, "queued"), tone: "muted" };
    case "completed":
      return {
        label: run.score === null ? t("live.done") : t("live.doneScore", { score: Math.round(run.score) }),
        tone: "success",
      };
    case "cancelled":
      return { label: statusLabel(t, "cancelled"), tone: "muted" };
    default:
      return { label: statusLabel(t, run.status), tone: "danger" };
  }
}

/** "2:41 · 7 turns · p50 1.1 s": live stats for the focused run, the summary's once finished. */
export function sessionMeta(t: Translator, run: Run, now: number, stats?: SessionStats): string {
  if (run.status === "queued") return t("live.startsWhenFree");
  const duration = runDurationMs(run, now);
  if (isActive(run.status) && duration === null) return t("live.starting");
  const summaryTurns = run.agentTurns === null && run.callerTurns === null ? null : (run.agentTurns ?? 0) + (run.callerTurns ?? 0);
  // Field by field: a live value the stream has not produced yet never hides a known summary one.
  const turns = stats && stats.turns > 0 ? stats.turns : summaryTurns;
  const p50 = stats?.p50Ms ?? run.latencyP50Ms;
  return [
    duration === null ? null : clock(duration),
    turns === null || turns === 0 ? null : t.plural("live.turns", turns),
    p50 === null ? null : `p50 ${latency(p50)}`,
    isActive(run.status) ? null : endReasonLabel(t, run.endReason, runKind(run)),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Batch progress bar segments; cancelled runs get their own only when there are some. */
export function batchSegments(t: Translator, runs: Pick<Run, "status">[]): ProgressSegment[] {
  const count = (...statuses: Run["status"][]) => runs.filter((run) => statuses.includes(run.status)).length;
  const segments: ProgressSegment[] = [
    { key: "completed", label: t("live.segment.completed"), value: count("completed"), tone: "success" },
    { key: "running", label: t("live.segment.running"), value: count("running", "connecting"), tone: "evaluator" },
    { key: "queued", label: t("live.segment.queued"), value: count("queued"), tone: "idle" },
    { key: "failed", label: t("live.segment.failed"), value: count("failed", "interrupted"), tone: "danger" },
  ];
  const cancelled = count("cancelled");
  return cancelled ? [...segments, { key: "cancelled", label: t("live.segment.cancelled"), value: cancelled, tone: "muted" }] : segments;
}

/** "HH:MM" in the browser's time zone. */
function hourMinute(locale: string, iso: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** "Hotel booking regression · started 16:02": the line under a batch's title (which names its id). */
export function batchSummary(t: Translator, batch: Pick<Batch, "label" | "createdAt">): string {
  return [
    batch.label,
    t("live.startedAt", { time: hourMinute(t.locale, batch.createdAt) }),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The connection layer words its give-up in English; this is that line, to translate it. */
const ENGLISH_GAVE_UP = createTranslator("en")("live.conn.gaveUp");

/**
 * Why the live stream stopped, in words: the close codes it knows in the page language, else the
 * connection's own message (its give-up line translated), else the give-up line. `subject` names
 * what streams.
 */
export function liveConnectionError(
  t: Translator,
  error: { code: number; message?: string | null },
  subject: "run" | "batch",
): string {
  const { code, message } = error;
  if (code === CLOSE_UNAUTHENTICATED) return t("live.conn.expired");
  if (code === CLOSE_FORBIDDEN_ORIGIN) return t("live.conn.origin");
  if (code === CLOSE_NOT_FOUND) return subject === "batch" ? t("live.conn.batchGone") : t("live.conn.runGone");
  return message && message !== ENGLISH_GAVE_UP ? message : t("live.conn.gaveUp");
}

/** Four time labels under the audio lanes: the window's start, two steps, then "now". */
export function laneAxis(t: Translator, elapsedMs: number, windowMs: number): string[] {
  const start = elapsedMs - windowMs;
  const step = windowMs / 3;
  return [0, 1, 2].map((index) => clock(Math.max(0, start + index * step))).concat(t("live.now"));
}
