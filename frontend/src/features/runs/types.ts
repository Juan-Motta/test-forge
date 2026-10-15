/** Run statuses and their order (runs/domain.py): queued -> connecting -> running -> one terminal. */
export const RUN_STATUSES = ["queued", "connecting", "running", "completed", "failed", "cancelled", "interrupted"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ["queued", "connecting", "running"];

export type BatchStatus = "queued" | "running" | "completed" | "cancelled";
export type AudioChannel = "agent" | "caller";

import type { RunCost } from "@/features/pricing/types";

/** A run as `GET /api/runs` returns it. */
export type Run = {
  id: string;
  batchId: string;
  position: number;
  scenarioId: string | null;
  scenarioName: string;
  agentId: string | null;
  agentName: string;
  /** Also the Langfuse session id. */
  threadId: string;
  status: RunStatus;
  endReason: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Judgement status (judgements/domain.py); null until the run is handed to the judge. */
  judgementStatus: string | null;
  /** The judgement's overall score (0-100), once completed. */
  score: number | null;
  /** Whether any must criterion failed, once the judgement completed; null otherwise. */
  mustFailed: boolean | null;
  /** Persona name from the launch snapshot. */
  persona: string | null;
  /** Turn counts and median agent latency from the summary; null until the run finished. */
  callerTurns: number | null;
  agentTurns: number | null;
  latencyP50Ms: number | null;
  /** The agent's kind from the launch snapshot; absent (voice) on older API responses. */
  agentKind?: AgentKind;
  /** The evaluator's approximate cost (caller + judge); null or absent before usage was recorded. */
  cost?: RunCost | null;
};

export type AgentKind = "voice" | "text";
/** How a text agent answers: one streamed reply, or the whole reply at once. */
export type TextMode = "stream" | "invoke";

/** One agent turn's timings (`summary.turns`). */
export type TurnTiming = {
  index: number;
  kind?: string;
  latencyMs: number | null;
  firstAudioMs?: number | null;
  endMs?: number | null;
  playbackEndMs?: number | null;
  endReason?: string | null;
  /** Text runs: run-clock ms the user message was sent, the first text and the full reply arrived. */
  requestMs?: number | null;
  firstTextMs?: number | null;
  /** Text runs: the tools the agent ran during the reply. */
  tools?: string[];
};

/** `summary.json` of a finished run (camelCase); every field may be missing on old artifacts. */
export type RunSummary = {
  /** `text` for text agents' runs; absent on voice runs. */
  kind?: AgentKind;
  textMode?: TextMode;
  maxTurns?: number;
  status?: string;
  reason?: string | null;
  error?: string | null;
  protocol?: string | null;
  model?: string | null;
  durationMs?: number;
  callerTurns?: number;
  agentTurns?: number;
  latenciesMs?: number[];
  turns?: TurnTiming[];
  warnings?: string[];
};

/**
 * One row of `transcript.json` (camelCase). Caller rows carry the evaluator's `reason`; interrupted
 * agent rows carry what the caller heard.
 */
export type TranscriptRow = {
  role: "agent" | "caller";
  text: string;
  startMs?: number | null;
  endMs?: number | null;
  playbackEndMs?: number | null;
  latencyMs?: number | null;
  reason?: string;
  /** Agent rows: the caller barged in; `text` stays the whole reply, `heardText` what played. */
  interrupted?: boolean;
  heardText?: string;
  /** Agent rows: how much of the reply had played when the caller cut in; `null`/0 = nothing. */
  audioEndMs?: number | null;
  /** Interrupted agent rows: `heardText` is estimated from the share of audio played (always, in practice). */
  heardTextEstimated?: true;
  /** Interrupted agent rows: the agent's server confirmed the correction; absent in older runs (unknown). */
  interruptionConfirmed?: boolean;
  /** Text agent rows: ms from the user message to the first text (null when none came). */
  firstTextMs?: number | null;
  /** Text agent rows: the tools the agent ran for this reply. */
  tools?: string[];
  /** Text agent rows: the reply broke off (the agent failed before finishing it). */
  incomplete?: boolean;
};

/** What the run was launched with (snake_case keys camelized by the API). */
export type RunSnapshot = {
  scenario: {
    id: string;
    name: string;
    persona: { name: string; locale: string; temperament: string; notes?: string };
    goal: string;
    endConditions: { maxDurationS: number; maxSilenceS: number; maxTurns?: number; hangUpWhen: string };
    /** Absent on runs launched before the realtime evaluator existed. */
    evaluatorMode?: "pipeline" | "realtime";
    /** The realtime evaluator's model; absent on pipeline runs and runs launched before the choice existed. */
    realtimeModel?: "gpt-realtime-2.1-mini" | "gpt-realtime-2.1";
  };
  /** `kind` absent: a voice agent (runs launched before text agents existed). */
  agent: { id: string; name: string; protocol: string; kind?: AgentKind; textMode?: TextMode };
  /** `tts` is null on text runs. */
  connections: { tts: { id: string; name: string } | null; evaluator: { id: string; name: string; chatModel: string | null } };
};

/** `GET /api/runs/{id}`: `summary` and `transcript` once the run finished. */
export type RunDetail = Run & {
  summary: RunSummary | null;
  transcript: TranscriptRow[] | null;
  snapshot: RunSnapshot;
};

export type RunPage = { items: Run[]; total: number };

export type Batch = {
  id: string;
  label: string | null;
  concurrency: number;
  status: BatchStatus;
  total: number;
  /** Runs per status. */
  counts: Partial<Record<RunStatus, number>>;
  createdBy: string | null;
  createdAt: string;
};

export type BatchDetail = Batch & { runs: Run[] };
export type BatchPage = { items: Batch[]; total: number };

export type LaunchInput = {
  scenarioIds: string[];
  repetitions: number;
  concurrency: number;
  label?: string;
};

/** `newest` (the default) lists the newest runs first, `oldest` the oldest first. */
export type RunOrder = "newest" | "oldest";

export type RunFilters = {
  status?: RunStatus;
  scenarioId?: string;
  batchId?: string;
  order?: RunOrder;
  limit?: number;
  offset?: number;
};

/** One transcript turn on the run timeline (`GET /api/runs/{id}/levels`); `ref` is A<n>/C<n>. */
export type LevelTurn = { role: "agent" | "caller"; startMs: number; endMs: number; ref: string };

/**
 * `GET /api/runs/{id}/levels`: RMS 0..1 per time bin for each side, both on the run timeline (one
 * scale), and the turns. 409 while the run is in progress.
 */
export type RunLevels = { durationMs: number; agent: number[]; caller: number[]; turns: LevelTurn[] };

/** One Langfuse observation of the run, offsets from the run start. */
export type TraceObservation = {
  id: string | null;
  traceId: string | null;
  parentId: string | null;
  /** "llm", "tool", "span", "event" or another Langfuse type in lowercase. */
  type: string;
  name: string | null;
  startMs: number | null;
  durationMs: number | null;
  model: string | null;
  tokens: number | null;
  costUsd: number | null;
  /** DEFAULT, DEBUG, WARNING or ERROR. */
  level: string;
  statusMessage: string | null;
  /** Nesting under the parent observation (0: a root). */
  depth: number;
};

/** `GET /api/runs/{id}/trace`: `available` false (with a `note`) when no observations were saved. */
export type RunTrace = {
  available: boolean;
  note: string | null;
  /** The judge digest's stats (camelCase); any key may be missing. */
  stats: (Record<string, unknown> & { totalTokens?: number; observationCount?: number }) | null;
  observations: TraceObservation[];
  /**
   * Links into Langfuse's UI; null without a Langfuse connection (or while the run is active).
   * `threadTracesUrl`: every turn of the run (null when Langfuse could not be asked for the project);
   * `traceUrl`: the first trace only (null without saved observations).
   */
  langfuse?: { threadTracesUrl: string | null; traceUrl: string | null } | null;
};
