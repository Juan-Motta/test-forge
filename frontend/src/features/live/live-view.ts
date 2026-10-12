import { STATUS_LABELS, clock, endReasonLabel, isActive, latency, median, runDurationMs } from "@/features/runs/format";
import type { Batch, Run, RunSnapshot } from "@/features/runs/types";
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

const EVALUATOR_LABELS = { pipeline: "Pipeline evaluator", realtime: "Realtime evaluator" } as const;

/** "Realtime evaluator · gpt-realtime-2.1", or null on runs launched before the choice existed. */
export function evaluatorChip(snapshot: RunSnapshot | undefined): string | null {
  const mode = snapshot?.scenario?.evaluatorMode;
  if (!mode) return null;
  const model = mode === "realtime" ? snapshot?.scenario?.realtimeModel : undefined;
  return [EVALUATOR_LABELS[mode], model].filter(Boolean).join(" · ");
}

/** The status chip of a session card. */
export function sessionChip(run: Pick<Run, "status" | "score">): { label: string; tone: BadgeTone } {
  switch (run.status) {
    case "running":
      return { label: "Live", tone: "danger" };
    case "connecting":
      return { label: STATUS_LABELS.connecting, tone: "agent" };
    case "queued":
      return { label: STATUS_LABELS.queued, tone: "muted" };
    case "completed":
      return { label: run.score === null ? "Done" : `Done · ${Math.round(run.score)}`, tone: "success" };
    case "cancelled":
      return { label: STATUS_LABELS.cancelled, tone: "muted" };
    default:
      return { label: STATUS_LABELS[run.status], tone: "danger" };
  }
}

const turnsText = (turns: number) => `${turns} ${turns === 1 ? "turn" : "turns"}`;

/** "2:41 · 7 turns · p50 1.1 s": live stats for the focused run, the summary's once finished. */
export function sessionMeta(run: Run, now: number, stats?: SessionStats): string {
  if (run.status === "queued") return "Starts when a slot frees up";
  const duration = runDurationMs(run, now);
  if (isActive(run.status) && duration === null) return "Starting…";
  const summaryTurns = run.agentTurns === null && run.callerTurns === null ? null : (run.agentTurns ?? 0) + (run.callerTurns ?? 0);
  const turns = stats?.turns ?? summaryTurns;
  const p50 = stats ? stats.p50Ms : run.latencyP50Ms;
  return [
    duration === null ? null : clock(duration),
    turns === null || turns === 0 ? null : turnsText(turns),
    p50 === null ? null : `p50 ${latency(p50)}`,
    isActive(run.status) ? null : endReasonLabel(run.endReason),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Batch progress bar segments; cancelled runs get their own only when there are some. */
export function batchSegments(runs: Pick<Run, "status">[]): ProgressSegment[] {
  const count = (...statuses: Run["status"][]) => runs.filter((run) => statuses.includes(run.status)).length;
  const segments: ProgressSegment[] = [
    { key: "completed", label: "completed", value: count("completed"), tone: "success" },
    { key: "running", label: "running", value: count("running", "connecting"), tone: "evaluator" },
    { key: "queued", label: "queued", value: count("queued"), tone: "idle" },
    { key: "failed", label: "failed", value: count("failed", "interrupted"), tone: "danger" },
  ];
  const cancelled = count("cancelled");
  return cancelled ? [...segments, { key: "cancelled", label: "cancelled", value: cancelled, tone: "muted" }] : segments;
}

/** "HH:MM" in the browser's time zone. */
function hourMinute(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

/** "Batch b0412f00 · Hotel booking regression · started 16:02". */
export function batchEyebrow(batch: Pick<Batch, "id" | "label" | "createdAt">): string {
  return [`Batch ${batch.id.slice(0, 8)}`, batch.label, `started ${hourMinute(batch.createdAt)}`].filter(Boolean).join(" · ");
}

/** Four time labels under the audio lanes: the window's start, two steps, then "now". */
export function laneAxis(elapsedMs: number, windowMs: number): string[] {
  const start = elapsedMs - windowMs;
  const step = windowMs / 3;
  return [0, 1, 2].map((index) => clock(Math.max(0, start + index * step))).concat("now");
}
