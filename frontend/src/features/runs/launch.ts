import { ApiError } from "@/lib/api";
import type { LaunchInput } from "./types";

export const MAX_REPETITIONS = 10;
export const MAX_CONCURRENCY = 10;
export const MAX_LABEL_LENGTH = 120;

export type LaunchDraft = { repetitions: string; concurrency: string; label: string };
export type LaunchErrors = Partial<Record<keyof LaunchDraft, string>>;

export const DEFAULT_DRAFT: LaunchDraft = { repetitions: "1", concurrency: "1", label: "" };

function count(value: string, max: number): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 1 && n <= max ? n : null;
}

/** The payload for `POST /api/runs`, or the field errors (same limits as the backend). */
export function toLaunchInput(
  scenarioIds: string[],
  draft: LaunchDraft,
): { input: LaunchInput; errors?: undefined } | { input?: undefined; errors: LaunchErrors } {
  const errors: LaunchErrors = {};
  const repetitions = count(draft.repetitions, MAX_REPETITIONS);
  const concurrency = count(draft.concurrency, MAX_CONCURRENCY);
  const label = draft.label.trim();
  if (repetitions === null) errors.repetitions = `Enter a whole number between 1 and ${MAX_REPETITIONS}.`;
  if (concurrency === null) errors.concurrency = `Enter a whole number between 1 and ${MAX_CONCURRENCY}.`;
  if (label.length > MAX_LABEL_LENGTH) errors.label = `Use at most ${MAX_LABEL_LENGTH} characters.`;
  if (repetitions === null || concurrency === null || Object.keys(errors).length > 0) return { errors };
  return { input: { scenarioIds, repetitions, concurrency, ...(label ? { label } : {}) } };
}

/** Planned run count, or null while a field is invalid. */
export function plannedRuns(scenarioCount: number, draft: LaunchDraft): number | null {
  const repetitions = count(draft.repetitions, MAX_REPETITIONS);
  return repetitions === null ? null : repetitions * scenarioCount;
}

/**
 * Rough wall time in minutes: the calls run in waves of `concurrency`, each wave as long as the
 * longest scenario's `maxDurationS` (an upper bound). Null while a field is invalid or no duration is known.
 */
export function estimatedMinutes(scenarios: { maxDurationS?: number }[], draft: LaunchDraft): number | null {
  const calls = plannedRuns(scenarios.length, draft);
  const concurrency = count(draft.concurrency, MAX_CONCURRENCY);
  const durations = scenarios.flatMap((scenario) => (scenario.maxDurationS ? [scenario.maxDurationS] : []));
  if (calls === null || concurrency === null || durations.length === 0) return null;
  const waves = Math.ceil(calls / concurrency);
  return Math.ceil((waves * Math.max(...durations)) / 60);
}

/**
 * The scenarios a 422 refused, as "name: reason" lines. The backend reports them under
 * `scenarioIds.<index>`; anything else (a plain validation error) yields no lines.
 */
export function notRunnableReasons(error: unknown, scenarios: { id: string; name: string }[]): string[] {
  if (!(error instanceof ApiError) || error.status !== 422) return [];
  const lines: string[] = [];
  for (const [path, message] of Object.entries(error.fieldErrors)) {
    const match = /^scenarioIds\.(\d+)$/.exec(path);
    if (!match) continue;
    const scenario = scenarios[Number(match[1])];
    lines.push(`${scenario?.name ?? "A scenario"}: ${message}`);
  }
  return lines;
}
