/** Enumerations the backend accepts (scenarios/domain.py). */
export const TEMPERAMENTS = ["polite", "hurried", "skeptical", "confused", "angry", "friendly", "calm", "detailed"] as const;
export type Temperament = (typeof TEMPERAMENTS)[number];
export const CRITERION_KINDS = ["must", "should"] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];
export const EVIDENCE_SOURCES = ["transcript", "trace", "timing"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export const HANG_UP_RULES = ["goal_or_goodbye", "goodbye", "max_duration"] as const;
export type HangUpWhen = (typeof HANG_UP_RULES)[number];

export type Persona = { name: string; locale: string; temperament: Temperament; notes: string };
/** Something the caller knows and reveals only when asked. */
export type Fact = { key: string; value: string };
export type Criterion = { id: string; text: string; kind: CriterionKind; source: EvidenceSource; weight: number };
export type EndConditions = { maxDurationS: number; maxSilenceS: number; hangUpWhen: HangUpWhen };

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
  goal: string;
  instructions: string;
  facts: Fact[];
  criteria: Criterion[];
  endConditions: EndConditions;
  createdAt: string;
  updatedAt: string;
};

/** A criterion without `id` is new: the backend generates one and keeps it afterwards. */
export type CriterionInput = Omit<Criterion, "id"> & { id?: string };

export type NewScenario = {
  agentId: string;
  name: string;
  tags: string[];
  context: string;
  persona: Persona;
  ttsConnectionId: string | null;
  evaluatorConnectionId: string | null;
  voiceOverride: string | null;
  goal: string;
  instructions: string;
  facts: Fact[];
  criteria: CriterionInput[];
  endConditions: EndConditions;
};

/**
 * Omitted fields are kept; `persona`, `facts`, `criteria` and `endConditions` replace the whole
 * stored value; `null` clears `ttsConnectionId`, `evaluatorConnectionId` or `voiceOverride`.
 */
export type ScenarioChanges = Partial<NewScenario>;
