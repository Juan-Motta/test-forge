import type { BadgeTone } from "@/ui";
import { ACTIVE_RUN_STATUSES, type Run, type RunStatus } from "./types";

export const STATUS_LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  connecting: "Connecting",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  interrupted: "Interrupted",
};

export const STATUS_TONES: Record<RunStatus, BadgeTone> = {
  queued: "neutral",
  connecting: "agent",
  running: "evaluator",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
  interrupted: "danger",
};

/** Why a run ended (the runner's reasons, plus the manager's), in words. */
const END_REASONS: Record<string, string> = {
  caller_hung_up: "Evaluator hung up",
  agent_ended: "Agent ended the call",
  max_duration: "Reached the maximum duration",
  max_silence: "Too long without speech",
  connect_failed: "Could not connect to the agent",
  connection_closed: "The agent connection closed",
  ready_timeout: "The agent never became ready",
  protocol_error: "Protocol error",
  evaluator_failed: "The evaluator model failed",
  tts_failed: "Speech synthesis failed",
  internal_error: "Internal error",
  setup_failed: "Could not set up the providers",
  cancelled: "Cancelled",
  shutdown: "The server stopped",
  server_restarted: "The server restarted",
  max_turns: "Reached the maximum turns",
  caller_silent: "The evaluator had nothing to say",
  agent_error: "The agent's reply failed",
};

/** Text runs: reasons worded for a chat rather than a call. */
const TEXT_END_REASONS: Record<string, string> = {
  caller_hung_up: "Evaluator ended the conversation",
};

export function endReasonLabel(reason: string | null | undefined, kind: "voice" | "text" = "voice"): string | null {
  if (!reason) return null;
  return (kind === "text" ? TEXT_END_REASONS[reason] : undefined) ?? END_REASONS[reason] ?? reason.replaceAll("_", " ");
}

export function isActive(status: RunStatus): boolean {
  return ACTIVE_RUN_STATUSES.includes(status);
}

/** `m:ss` (or `h:mm:ss`) for a duration in milliseconds. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** Wall-clock duration of a run (to now while it is active), or null before it started. */
export function runDurationMs(run: Pick<Run, "startedAt" | "endedAt">, now: number = Date.now()): number | null {
  if (!run.startedAt) return null;
  const start = Date.parse(run.startedAt);
  const end = run.endedAt ? Date.parse(run.endedAt) : now;
  return Number.isNaN(start) || Number.isNaN(end) ? null : Math.max(0, end - start);
}

/** Median of the values (the mean of the middle two for an even count); null when empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** "420 ms" under a second, "1.4 s" above. */
export function latency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** First and last characters of a long id: `1786f832…3f`. */
export function shortId(id: string, head = 8, tail = 2): string {
  return id.length <= head + tail + 1 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}
