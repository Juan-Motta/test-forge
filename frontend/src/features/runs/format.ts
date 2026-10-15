import type { Translator } from "@/lib/i18n";
import type { BadgeTone } from "@/ui";
import { ACTIVE_RUN_STATUSES, type Run, type RunStatus } from "./types";

export function statusLabel(t: Translator, status: RunStatus): string {
  return t(`runs.status.${status}`);
}

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
const END_REASONS = [
  "caller_hung_up",
  "agent_ended",
  "max_duration",
  "max_silence",
  "connect_failed",
  "connection_closed",
  "ready_timeout",
  "protocol_error",
  "evaluator_failed",
  "tts_failed",
  "internal_error",
  "setup_failed",
  "cancelled",
  "shutdown",
  "server_restarted",
  "max_turns",
  "caller_silent",
  "agent_error",
] as const;
type EndReason = (typeof END_REASONS)[number];

export function endReasonLabel(
  t: Translator,
  reason: string | null | undefined,
  kind: "voice" | "text" = "voice",
): string | null {
  if (!reason) return null;
  // Text runs: worded for a chat rather than a call.
  if (kind === "text" && reason === "caller_hung_up") return t("runs.endText.caller_hung_up");
  return (END_REASONS as readonly string[]).includes(reason) ? t(`runs.end.${reason as EndReason}`) : reason.replaceAll("_", " ");
}

/** End reasons that only say what the status already does (a cancelled run ended because it was cancelled). */
const STATUS_REPEATING_REASONS: Partial<Record<RunStatus, readonly EndReason[]>> = { cancelled: ["cancelled"] };

/** Whether `reason` adds nothing to `status`, compared by code (never by translated text). */
export function endReasonRepeatsStatus(status: RunStatus, reason: string | null | undefined): boolean {
  return !!reason && (STATUS_REPEATING_REASONS[status] as readonly string[] | undefined)?.includes(reason) === true;
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
