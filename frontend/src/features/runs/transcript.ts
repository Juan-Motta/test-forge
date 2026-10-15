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
  /** Live caller lines: the evaluator decision they say (the realtime evaluator's words stream into it). */
  decisionId?: number;
  /** The judge's ref of a finished run's row: `A<n>` (agent) or `C<n>` (caller), counted per role. */
  ref?: string;
  /** Live agent lines: the runner's 0-based agent turn index. */
  turn?: number;
  /** Agent lines the caller cut off. */
  interruption?: Interruption;
  /** Text agent lines: ms from the user message to the first text, and to the full reply. */
  firstTextMs?: number | null;
  fullReplyMs?: number | null;
  /** Text agent lines: the tools the agent ran for this reply (`success` once known, live). */
  tools?: ToolUse[];
  /** Text agent lines: the reply broke off before the agent finished it. */
  incomplete?: boolean;
  /** Live text agent lines still being written. */
  streaming?: boolean;
};

/** A tool the agent ran during a reply; `success` is known once it ended (live runs only). */
export type ToolUse = { name: string; success?: boolean };

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

/** The text fields of an agent row: timings from the user message before it, tools, broken off. */
function textFieldsOf(row: TranscriptRow, sentMs: number | null): Partial<TranscriptEntry> {
  if (row.role !== "agent") return {};
  const fields: Partial<TranscriptEntry> = {};
  if (row.firstTextMs !== undefined) fields.firstTextMs = row.firstTextMs;
  if (row.tools !== undefined) fields.tools = row.tools.map((name) => ({ name }));
  if (row.incomplete) fields.incomplete = true;
  if (row.tools !== undefined && !row.incomplete && sentMs !== null && typeof row.endMs === "number") {
    fields.fullReplyMs = row.endMs - sentMs;
  }
  return fields;
}

/** Entries from `transcript.json` rows (finished run) or a live snapshot's transcript. */
/** The realtime evaluator's only "reason" names the mode: not an intent worth showing. */
const REALTIME_REASON = "realtime";

/** A caller line's intent: its reason, unless it is only the realtime placeholder. */
export function callerIntent(reason: string | null | undefined): string | undefined {
  return reason && reason !== REALTIME_REASON ? reason : undefined;
}

export function entriesFromRows(rows: readonly (TranscriptRow & { tMs?: number })[]): TranscriptEntry[] {
  const counters = { agent: 0, caller: 0 };
  // Text runs: an agent reply's full time runs from the user message before it.
  let sentMs: number | null = null;
  return rows.map((row, index) => {
    const tMs = row.startMs ?? row.tMs ?? null;
    if (row.role === "caller") sentMs = tMs;
    return {
      ref: `${row.role === "agent" ? "A" : "C"}${(counters[row.role] += 1)}`,
      key: `row-${index}`,
      role: row.role,
      text: row.text,
      tMs,
      latencyMs: row.role === "agent" ? (row.latencyMs ?? null) : undefined,
      intent: row.role === "caller" ? callerIntent(row.reason) : undefined,
      interruption: interruptionOf(row),
      ...textFieldsOf(row, sentMs),
    };
  });
}
