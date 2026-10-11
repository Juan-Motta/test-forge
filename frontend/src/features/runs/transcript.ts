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
};

/** Entries from `transcript.json` rows (finished run) or a live snapshot's transcript. */
export function entriesFromRows(rows: readonly (TranscriptRow & { tMs?: number })[]): TranscriptEntry[] {
  return rows.map((row, index) => ({
    key: `row-${index}`,
    role: row.role,
    text: row.text,
    tMs: row.startMs ?? row.tMs ?? null,
    latencyMs: row.role === "agent" ? (row.latencyMs ?? null) : undefined,
    intent: row.role === "caller" ? row.reason || undefined : undefined,
  }));
}
