import type { TranscriptEntry } from "@/features/runs/transcript";
import { entriesFromRows } from "@/features/runs/transcript";
import type { RunStatus, TranscriptRow } from "@/features/runs/types";

/** What the conversation is doing right now, from the latest events. */
export type TurnState = "waiting" | "agent" | "playback" | "evaluator" | "hanging_up" | "ended";

export const TURN_STATE_LABELS: Record<TurnState, string> = {
  waiting: "Waiting for the agent",
  agent: "Agent speaking",
  playback: "Agent finished · waiting for its audio to play out",
  evaluator: "Evaluator speaking",
  hanging_up: "Evaluator is hanging up",
  ended: "Call ended",
};

export type Decision = {
  decisionId: number | null;
  say: string | null;
  hangUp: boolean;
  reason: string;
  tMs: number | null;
  /** The agent spoke again before it was said: it never will be. */
  discarded: boolean;
};
/** What the evaluator decided to say but has not started saying yet. */
export type PendingLine = { decisionId: number | null; say: string; tMs: number | null };
/** The agent started a turn while the evaluator was mid-utterance. */
export type BargeIn = { tMs: number | null; callerTurn: number | null };
type Turn = { turn: number; latencyMs: number | null };

export type LiveRunState = {
  status: RunStatus | null;
  endReason: string | null;
  finished: boolean;
  entries: TranscriptEntry[];
  turns: Turn[];
  decision: Decision | null;
  pending: PendingLine | null;
  bargeIns: BargeIn[];
  turnState: TurnState;
  warnings: string[];
  /** Times (`Date.now()`) the server dropped audio for this consumer. */
  laggingAt: number | null;
  seq: number;
};

export const INITIAL_LIVE_STATE: LiveRunState = {
  status: null,
  endReason: null,
  finished: false,
  entries: [],
  turns: [],
  decision: null,
  pending: null,
  bargeIns: [],
  turnState: "waiting",
  warnings: [],
  laggingAt: null,
  seq: 0,
};

export type LiveAction =
  | { type: "message"; message: Record<string, unknown>; now: number }
  | { type: "audio"; channel: number };

const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

function turnsFrom(value: unknown): Turn[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: Record<string, unknown>, index) => ({
    turn: num(item.turn) ?? num(item.index) ?? index,
    latencyMs: num(item.latencyMs),
  }));
}

/** Snapshot rows (live: `tMs`, `turn`; finished: `startMs`, `latencyMs`) as entries with latency. */
function snapshotEntries(rows: unknown, turns: Turn[]): TranscriptEntry[] {
  if (!Array.isArray(rows)) return [];
  const typed = rows as (TranscriptRow & { tMs?: number; turn?: number })[];
  return entriesFromRows(typed).map((entry, index) => {
    const turn = typed[index].turn;
    if (entry.role !== "agent" || entry.latencyMs != null || turn === undefined) return entry;
    return { ...entry, latencyMs: turns.find((item) => item.turn === turn)?.latencyMs ?? null };
  });
}

/**
 * Folds the live stream into what the page shows. A `snapshot` replaces everything (it is the
 * first message of every connection, reconnections included); later events append in order.
 */
export function liveReducer(state: LiveRunState, action: LiveAction): LiveRunState {
  if (action.type === "audio") {
    if (state.finished) return state;
    const turnState: TurnState = action.channel === 0 ? "agent" : "evaluator";
    return state.turnState === turnState ? state : { ...state, turnState };
  }
  const message = action.message;
  switch (message.type) {
    case "snapshot": {
      const run = (message.run ?? {}) as Record<string, unknown>;
      const turns = turnsFrom(message.turns);
      const entries = snapshotEntries(message.transcript, turns);
      return {
        ...INITIAL_LIVE_STATE,
        status: (str(run.status) || null) as RunStatus | null,
        endReason: (run.endReason as string | null) ?? null,
        entries,
        turns,
        seq: entries.length,
        laggingAt: state.laggingAt,
      };
    }
    case "status":
      return { ...state, status: str(message.status) as RunStatus };
    case "agentTranscript": {
      const turn = num(message.turn);
      const latencyMs = state.turns.find((item) => item.turn === turn)?.latencyMs ?? null;
      const entry: TranscriptEntry = {
        key: `live-${state.seq}`,
        role: "agent",
        text: str(message.text),
        tMs: num(message.tMs),
        latencyMs,
      };
      return { ...state, entries: [...state.entries, entry], seq: state.seq + 1 };
    }
    case "callerDecision": {
      // Only an intent: the line joins the transcript on `callerSpeaking`.
      const say = typeof message.say === "string" && message.say ? message.say : null;
      const decision: Decision = {
        decisionId: num(message.decisionId),
        say,
        hangUp: message.hangUp === true,
        reason: str(message.reason),
        tMs: num(message.tMs),
        discarded: false,
      };
      if (say) return { ...state, decision, pending: { decisionId: decision.decisionId, say, tMs: decision.tMs } };
      return { ...state, decision, pending: null, turnState: decision.hangUp ? "hanging_up" : "waiting" };
    }
    case "callerSpeaking": {
      const entry: TranscriptEntry = {
        key: `live-${state.seq}`,
        role: "caller",
        text: str(message.say),
        tMs: num(message.tMs),
        intent: str(message.reason) || undefined,
      };
      const pending = state.pending?.decisionId === num(message.decisionId) ? null : state.pending;
      return { ...state, pending, turnState: "evaluator", entries: [...state.entries, entry], seq: state.seq + 1 };
    }
    case "callerDecisionDiscarded": {
      const id = num(message.decisionId);
      const pending = state.pending?.decisionId === id ? null : state.pending;
      const decision = state.decision?.decisionId === id ? { ...state.decision, discarded: true } : state.decision;
      return { ...state, pending, decision };
    }
    case "agentBargeIn":
      return { ...state, bargeIns: [...state.bargeIns, { tMs: num(message.tMs), callerTurn: num(message.callerTurn) }] };
    case "turnEnded":
      return {
        ...state,
        turns: [...state.turns, { turn: num(message.turn) ?? state.turns.length, latencyMs: num(message.latencyMs) }],
        turnState: "playback",
      };
    case "warning":
      return { ...state, warnings: [...state.warnings, str(message.message)] };
    case "lagging":
      return { ...state, laggingAt: action.now };
    case "finished":
      return {
        ...state,
        status: str(message.status) as RunStatus,
        endReason: (message.reason as string | null) ?? null,
        finished: true,
        turnState: "ended",
      };
    default:
      return state;
  }
}
