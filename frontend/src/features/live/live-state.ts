import type { TranscriptEntry } from "@/features/runs/transcript";
import { entriesFromRows } from "@/features/runs/transcript";
import { isActive } from "@/features/runs/format";
import { RUN_STATUSES, type RunStatus, type TranscriptRow } from "@/features/runs/types";

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
/** The caller cut agent reply #`agentTurn` (1-based, like the scenario) once `audioEndMs` had played. */
export type CallerInterruption = {
  agentTurn: number | null;
  audioEndMs: number | null;
  heardText: string;
  tMs: number | null;
  /** The target item the caller cut, when reported. */
  itemId?: string;
  /** Set once the agent's server confirmed the correction (`interruptionConfirmed`). */
  confirmed?: true;
  kind?: "truncated" | "deleted";
};

export type LiveRunState = {
  status: RunStatus | null;
  endReason: string | null;
  finished: boolean;
  entries: TranscriptEntry[];
  turns: Turn[];
  decision: Decision | null;
  pending: PendingLine | null;
  bargeIns: BargeIn[];
  interruptions: CallerInterruption[];
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
  interruptions: [],
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
    if (entry.role !== "agent" || turn === undefined) return entry;
    if (entry.latencyMs != null) return { ...entry, turn };
    return { ...entry, turn, latencyMs: turns.find((item) => item.turn === turn)?.latencyMs ?? null };
  });
}

/** The live (0-based) agent turn an interruption of reply #`agentTurn` (1-based) applies to. */
const liveTurnOf = (interruption: CallerInterruption) =>
  interruption.agentTurn === null ? null : interruption.agentTurn - 1;

function interrupted(entry: TranscriptEntry, interruption: CallerInterruption): TranscriptEntry {
  const { heardText, audioEndMs, confirmed } = interruption;
  return { ...entry, interruption: confirmed ? { heardText, audioEndMs, confirmed } : { heardText, audioEndMs } };
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
      const status = (str(run.status) || null) as RunStatus | null;
      // A run that already ended gets no `finished` event: its snapshot is the final state.
      const finished = status !== null && RUN_STATUSES.includes(status) && !isActive(status);
      return {
        ...INITIAL_LIVE_STATE,
        status,
        finished,
        turnState: finished ? "ended" : "waiting",
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
        ...(turn === null ? {} : { turn }),
      };
      // The interruption can arrive before the transcript of the reply it cut.
      const cut = turn === null ? undefined : state.interruptions.find((item) => liveTurnOf(item) === turn);
      const next = cut ? interrupted(entry, cut) : entry;
      return { ...state, entries: [...state.entries, next], seq: state.seq + 1 };
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
    case "callerInterrupted":
    case "caller_interrupted": {
      const interruption: CallerInterruption = {
        agentTurn: num(message.agentTurn ?? message.agent_turn),
        audioEndMs: num(message.audioEndMs ?? message.audio_end_ms),
        heardText: str(message.heardText ?? message.heard_text),
        tMs: num(message.tMs),
        ...(str(message.itemId) ? { itemId: str(message.itemId) } : {}),
      };
      const turn = liveTurnOf(interruption);
      const entries = state.entries.map((entry) =>
        entry.role === "agent" && turn !== null && entry.turn === turn ? interrupted(entry, interruption) : entry,
      );
      return { ...state, entries, interruptions: [...state.interruptions, interruption] };
    }
    case "interruptionConfirmed": {
      const agentTurn = num(message.agentTurn);
      const itemId = str(message.itemId);
      // The interruption this confirms: same item when both know it, else the open one of that reply.
      const index = state.interruptions.findIndex(
        (item) => !item.confirmed && (item.itemId && itemId ? item.itemId === itemId : item.agentTurn === agentTurn),
      );
      if (index === -1) return state;
      const kind = message.kind === "truncated" || message.kind === "deleted" ? message.kind : undefined;
      const confirmed: CallerInterruption = { ...state.interruptions[index], confirmed: true, ...(kind ? { kind } : {}) };
      const interruptions = state.interruptions.map((item, i) => (i === index ? confirmed : item));
      const turn = liveTurnOf(confirmed);
      const entries = state.entries.map((entry) =>
        entry.role === "agent" && turn !== null && entry.turn === turn ? interrupted(entry, confirmed) : entry,
      );
      return { ...state, entries, interruptions };
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

/** Whether the agent confirmed the correction an interruption asked for, as of now. */
export function confirmationLabel(interruption: CallerInterruption, finished: boolean): string {
  if (interruption.confirmed) return "Correction confirmed";
  return finished ? "Not confirmed" : "Waiting for the agent to confirm the correction";
}
