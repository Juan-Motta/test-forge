import type { TranscriptEntry } from "@/features/runs/transcript";
import { callerIntent, entriesFromRows } from "@/features/runs/transcript";
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

/** Text runs: the same states, worded for a chat (`playback`: the reply is in, the evaluator writes). */
const TEXT_TURN_STATE_LABELS: Record<TurnState, string> = {
  waiting: "Waiting",
  agent: "Agent replying",
  playback: "Evaluator writing",
  evaluator: "Message sent · waiting for the agent",
  hanging_up: "Evaluator is ending the conversation",
  ended: "Conversation ended",
};

export function turnStateLabel(state: TurnState, kind: "voice" | "text" = "voice"): string {
  return (kind === "text" ? TEXT_TURN_STATE_LABELS : TURN_STATE_LABELS)[state];
}

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
/** An agent turn's timings; text runs also carry when the message was sent and the reply arrived (run clock). */
type Turn = {
  turn: number;
  latencyMs: number | null;
  requestMs?: number | null;
  firstTextMs?: number | null;
  endMs?: number | null;
};
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

function turnOf(item: Record<string, unknown>, fallback: number): Turn {
  const turn: Turn = { turn: num(item.turn) ?? num(item.index) ?? fallback, latencyMs: num(item.latencyMs) };
  if (typeof item.requestMs !== "number") return turn;
  return { ...turn, requestMs: item.requestMs, firstTextMs: num(item.firstTextMs), endMs: num(item.endMs) };
}

function turnsFrom(value: unknown): Turn[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: Record<string, unknown>, index) => turnOf(item, index));
}

/** A text reply's timings from its turn: first text and full reply, both from the user message. */
function withTextTiming(entry: TranscriptEntry, turn: Turn | undefined): TranscriptEntry {
  if (!turn || typeof turn.requestMs !== "number") return entry;
  const since = (value: number | null | undefined) => (typeof value === "number" ? value - turn.requestMs! : null);
  return { ...entry, latencyMs: turn.latencyMs, firstTextMs: since(turn.firstTextMs), fullReplyMs: since(turn.endMs) };
}

/** The entry without its `streaming` flag. */
function settled(entry: TranscriptEntry): TranscriptEntry {
  const copy = { ...entry };
  delete copy.streaming;
  return copy;
}

/** The index of the text reply still streaming for `turn`, or -1. */
const streamingIndex = (entries: TranscriptEntry[], turn: number | null) =>
  entries.findIndex((entry) => entry.streaming && entry.role === "agent" && entry.turn === turn);

/** Applies `change` to the streaming reply of the message's turn, opening it on its first event. */
function onStreaming(
  state: LiveRunState,
  message: Record<string, unknown>,
  change: (entry: TranscriptEntry) => TranscriptEntry,
): LiveRunState {
  const turn = num(message.turn);
  const index = streamingIndex(state.entries, turn);
  if (index === -1) {
    const opened: TranscriptEntry = {
      key: `live-${state.seq}`,
      role: "agent",
      text: "",
      tMs: num(message.tMs),
      tools: [],
      streaming: true,
      ...(turn === null ? {} : { turn }),
    };
    return { ...state, turnState: "agent", entries: [...state.entries, change(opened)], seq: state.seq + 1 };
  }
  const entries = state.entries.map((entry, i) => (i === index ? change(entry) : entry));
  return { ...state, turnState: "agent", entries };
}

/** Snapshot rows (live: `tMs`, `turn`; finished: `startMs`, `latencyMs`) as entries with latency. */
function snapshotEntries(rows: unknown, turns: Turn[]): TranscriptEntry[] {
  if (!Array.isArray(rows)) return [];
  const typed = rows as (TranscriptRow & { tMs?: number; turn?: number; decisionId?: number })[];
  return entriesFromRows(typed).map((entry, index) => {
    const { turn, decisionId } = typed[index];
    if (entry.role === "caller") return typeof decisionId === "number" ? { ...entry, decisionId } : entry;
    if (turn === undefined) return entry;
    const timing = turns.find((item) => item.turn === turn);
    if (timing && typeof timing.requestMs === "number") return withTextTiming({ ...entry, turn }, timing);
    if (entry.latencyMs != null) return { ...entry, turn };
    return { ...entry, turn, latencyMs: timing?.latencyMs ?? null };
  });
}

/** The index of the caller line saying decision `decisionId`, or -1. */
const callerLineIndex = (entries: TranscriptEntry[], decisionId: number | null) =>
  decisionId === null ? -1 : entries.findLastIndex((entry) => entry.role === "caller" && entry.decisionId === decisionId);

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
    case "agentTextDelta":
      // The reply's time is its first text, like the finished transcript's.
      return onStreaming(state, message, (entry) => ({
        ...entry,
        text: entry.text + str(message.text),
        tMs: entry.text ? entry.tMs : (num(message.tMs) ?? entry.tMs),
      }));
    case "agentToolStarted":
      return onStreaming(state, message, (entry) => ({ ...entry, tools: [...(entry.tools ?? []), { name: str(message.name) }] }));
    case "agentToolEnded":
      return onStreaming(state, message, (entry) => {
        const tools = [...(entry.tools ?? [])];
        const index = tools.findLastIndex((tool) => tool.name === str(message.name) && tool.success === undefined);
        if (index !== -1 && typeof message.success === "boolean") tools[index] = { ...tools[index], success: message.success };
        return { ...entry, tools };
      });
    case "agentTranscript": {
      const turn = num(message.turn);
      const streaming = streamingIndex(state.entries, turn);
      if (streaming !== -1) {
        // A text reply that streamed in: the transcript is its final text.
        const entries = state.entries.map((entry, i) =>
          i === streaming ? { ...settled(entry), text: str(message.text) || entry.text } : entry,
        );
        return { ...state, entries };
      }
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
      const decisionId = num(message.decisionId);
      const decision: Decision = {
        decisionId,
        say,
        hangUp: message.hangUp === true,
        reason: str(message.reason),
        tMs: num(message.tMs),
        discarded: false,
      };
      // The realtime evaluator decides once it said it: its whole transcript closes its line.
      const spoken = callerLineIndex(state.entries, decisionId);
      if (spoken !== -1) {
        const entries = say ? state.entries.map((entry, i) => (i === spoken ? { ...entry, text: say } : entry)) : state.entries;
        // Its audio already went out: only a hang-up changes what the call is doing now.
        return { ...state, decision, entries, turnState: decision.hangUp ? "hanging_up" : state.turnState };
      }
      if (say) return { ...state, decision, pending: { decisionId, say, tMs: decision.tMs } };
      return { ...state, decision, pending: null, turnState: decision.hangUp ? "hanging_up" : "waiting" };
    }
    case "callerSpeaking": {
      const decisionId = num(message.decisionId);
      const entry: TranscriptEntry = {
        key: `live-${state.seq}`,
        role: "caller",
        text: str(message.say),
        tMs: num(message.tMs),
        intent: callerIntent(str(message.reason)),
        ...(decisionId === null ? {} : { decisionId }),
      };
      const pending = state.pending?.decisionId === num(message.decisionId) ? null : state.pending;
      return { ...state, pending, turnState: "evaluator", entries: [...state.entries, entry], seq: state.seq + 1 };
    }
    case "callerText": {
      // The next piece of what the realtime evaluator is saying, in order.
      const index = callerLineIndex(state.entries, num(message.decisionId));
      if (index === -1) return state;
      const entries = state.entries.map((entry, i) => (i === index ? { ...entry, text: entry.text + str(message.text) } : entry));
      return { ...state, entries };
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
    case "turnEnded": {
      const turn = turnOf(message, state.turns.length);
      // Text replies get their timings now: the transcript came first.
      const entries =
        typeof turn.requestMs === "number"
          ? state.entries.map((entry) => (entry.role === "agent" && entry.turn === turn.turn ? withTextTiming(entry, turn) : entry))
          : state.entries;
      return { ...state, entries, turns: [...state.turns, turn], turnState: "playback" };
    }
    case "warning":
      return { ...state, warnings: [...state.warnings, str(message.message)] };
    case "lagging":
      return { ...state, laggingAt: action.now };
    case "finished":
      return {
        ...state,
        // A text reply still streaming never finished: it broke off.
        entries: state.entries.map((entry) => (entry.streaming ? { ...settled(entry), incomplete: true } : entry)),
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
