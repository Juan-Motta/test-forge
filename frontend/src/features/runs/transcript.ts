import type { TranscriptRow } from "./types";

/** One line of a conversation as the UI shows it (finished runs and live runs alike). */
export type TranscriptEntry = {
  key: string;
  role: "agent" | "caller";
  text: string;
  /** Milliseconds since the run started, when known. */
  tMs: number | null;
  /** Agent lines: how long the agent took to answer. */
  latencyMs?: number | null;
  /** Caller lines: the evaluator's own reason for saying it. */
  intent?: string;
  /** The judge's ref of a finished run's row: `A<n>` (agent) or `C<n>` (caller), counted per role. */
  ref?: string;
  /** Live agent lines: the runner's 0-based agent turn index. */
  turn?: number;
  /** Agent lines the caller cut off. */
  interruption?: Interruption;
};

/**
 * Where the caller cut an agent line: what had played (`heardText`, an estimate from the share of
 * audio played) and when (`audioEndMs`). `confirmed`: whether the agent's server confirmed the
 * correction; `undefined` when unknown (older runs, or not reported yet).
 */
export type Interruption = { heardText: string; audioEndMs: number | null; confirmed?: boolean };

/** An interrupted line split into what the caller heard and the rest; `null` when the heard text is not its start. */
export function splitHeard(text: string, heardText: string): { heard: string; unheard: string } | null {
  const heard = heardText.trim();
  if (!heard) return { heard: "", unheard: text.trim() };
  if (!text.startsWith(heard)) return null;
  return { heard, unheard: text.slice(heard.length).trim() };
}

/** "at 4.0 s", or that nothing had played yet. */
export function interruptedAt(audioEndMs: number | null): string {
  return audioEndMs ? `at ${(audioEndMs / 1000).toFixed(1)} s` : "before any audio played";
}

function interruptionOf(row: TranscriptRow): Interruption | undefined {
  if (row.role !== "agent" || !row.interrupted) return undefined;
  const interruption: Interruption = { heardText: row.heardText ?? "", audioEndMs: row.audioEndMs ?? null };
  return typeof row.interruptionConfirmed === "boolean"
    ? { ...interruption, confirmed: row.interruptionConfirmed }
    : interruption;
}

/** Entries from `transcript.json` rows (finished run) or a live snapshot's transcript. */
export function entriesFromRows(rows: readonly (TranscriptRow & { tMs?: number })[]): TranscriptEntry[] {
  const counters = { agent: 0, caller: 0 };
  return rows.map((row, index) => ({
    ref: `${row.role === "agent" ? "A" : "C"}${(counters[row.role] += 1)}`,
    key: `row-${index}`,
    role: row.role,
    text: row.text,
    tMs: row.startMs ?? row.tMs ?? null,
    latencyMs: row.role === "agent" ? (row.latencyMs ?? null) : undefined,
    intent: row.role === "caller" ? row.reason || undefined : undefined,
    interruption: interruptionOf(row),
  }));
}
