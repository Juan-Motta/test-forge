/** Enumerations the backend accepts (scenarios/domain.py). */
export const TEMPERAMENTS = ["polite", "hurried", "skeptical", "confused", "angry", "friendly", "calm", "detailed"] as const;
export type Temperament = (typeof TEMPERAMENTS)[number];
export const CRITERION_KINDS = ["must", "should"] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];
export const EVIDENCE_SOURCES = ["transcript", "trace", "timing"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export const HANG_UP_RULES = ["goal_or_goodbye", "goodbye", "max_duration"] as const;
export type HangUpWhen = (typeof HANG_UP_RULES)[number];
/** `pipeline`: a chat model decides the words and TTS speaks them. `realtime`: a speech-to-speech model. */
export const EVALUATOR_MODES = ["pipeline", "realtime"] as const;
export type EvaluatorMode = (typeof EVALUATOR_MODES)[number];
/** Speech-to-speech models the realtime evaluator can use; the mini one is the default. */
export const REALTIME_MODELS = ["gpt-realtime-2.1-mini", "gpt-realtime-2.1"] as const;
export type RealtimeModel = (typeof REALTIME_MODELS)[number];
export const DEFAULT_REALTIME_MODEL: RealtimeModel = "gpt-realtime-2.1-mini";
/** Voices the realtime evaluator models (gpt-realtime-2.1-mini and gpt-realtime-2.1) can speak with. */
export const REALTIME_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"] as const;

export type Persona = { name: string; locale: string; temperament: Temperament; notes: string };
/** Something the caller knows and reveals only when asked. */
export type Fact = { key: string; value: string };
export type Criterion = { id: string; text: string; kind: CriterionKind; source: EvidenceSource; weight: number };
/** `maxSilenceS` applies to voice agents only, `maxTurns` (messages the user sends, 1–100) to text agents only. */
export type EndConditions = { maxDurationS: number; maxSilenceS: number; maxTurns: number; hangUpWhen: HangUpWhen };
/** The backend's default `maxTurns`, also read for scenarios stored before it existed. */
export const DEFAULT_MAX_TURNS = 20;
/** The caller cuts agent reply #`agentTurn` (1-based) once `afterMs` of it has played. */
export type Interruption = { agentTurn: number; afterMs: number };

/** A scenario as `GET /api/scenarios` returns it. */
export type Scenario = {
  id: string;
  agentId: string;
  agent: { id: string; name: string };
  name: string;
  tags: string[];
  context: string;
  persona: Persona;
  ttsConnectionId: string | null;
  /** Connection whose chat model plays the caller; `null` uses the voice (TTS) connection. */
  evaluatorConnectionId: string | null;
  voiceOverride: string | null;
  /** Absent on scenarios stored before the realtime evaluator existed (they use the pipeline). */
  evaluatorMode?: EvaluatorMode;
  /** Used only by the realtime evaluator; absent on scenarios stored before the choice existed (the mini model). */
  realtimeModel?: RealtimeModel;
  goal: string;
  instructions: string;
  facts: Fact[];
  criteria: Criterion[];
  endConditions: EndConditions;
  /** Barge-ins the caller performs; empty when it always lets the agent finish. */
  interruptions: Interruption[];
  createdAt: string;
  updatedAt: string;
};

/** A criterion without `id` is new: the backend generates one and keeps it afterwards. */
export type CriterionInput = Omit<Criterion, "id"> & { id?: string };

/** The voice-only settings are left out for text agents (the backend keeps its defaults or the stored values). */
export type NewScenario = {
  agentId: string;
  name: string;
  tags: string[];
  context: string;
  persona: Persona;
  ttsConnectionId?: string | null;
  evaluatorConnectionId: string | null;
  voiceOverride?: string | null;
  evaluatorMode?: EvaluatorMode;
  realtimeModel?: RealtimeModel;
  goal: string;
  instructions: string;
  facts: Fact[];
  criteria: CriterionInput[];
  endConditions: EndConditions;
  interruptions?: Interruption[];
};

/**
 * Omitted fields are kept; `persona`, `facts`, `criteria`, `endConditions` and `interruptions` replace the whole
 * stored value; `null` clears `ttsConnectionId`, `evaluatorConnectionId` or `voiceOverride`.
 */
export type ScenarioChanges = Partial<NewScenario>;
