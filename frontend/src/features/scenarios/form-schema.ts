import { z } from "zod";
import {
  CRITERION_KINDS,
  EVIDENCE_SOURCES,
  HANG_UP_RULES,
  TEMPERAMENTS,
  type CriterionKind,
  type EvidenceSource,
  type HangUpWhen,
  type NewScenario,
  type Scenario,
  type ScenarioChanges,
  type Temperament,
} from "./types";

/**
 * Form state. Paths match the API's error locations (`persona.locale`, `facts.2.key`,
 * `criteria.0.weight`, `endConditions.maxDurationS`) so server errors land on the right input.
 * Numbers are kept as typed text; tags are one comma-separated string.
 */
export type ScenarioFormValues = {
  agentId: string;
  name: string;
  tags: string;
  context: string;
  persona: { name: string; locale: string; temperament: Temperament; notes: string };
  ttsConnectionId: string;
  voiceOverride: string;
  goal: string;
  instructions: string;
  facts: { key: string; value: string }[];
  /** `criterionId` (not `id`, which the field array uses for its own keys) is "" for a new row. */
  criteria: { criterionId: string; text: string; kind: CriterionKind; source: EvidenceSource; weight: string }[];
  endConditions: { maxDurationS: string; maxSilenceS: string; hangUpWhen: HangUpWhen };
};

export const TEMPERAMENT_LABELS: Record<Temperament, string> = {
  polite: "Polite",
  hurried: "Hurried",
  skeptical: "Skeptical",
  confused: "Confused",
  angry: "Angry",
  friendly: "Friendly",
  calm: "Calm",
  detailed: "Detailed",
};
export const KIND_LABELS: Record<CriterionKind, string> = { must: "Must", should: "Should" };
export const SOURCE_LABELS: Record<EvidenceSource, string> = {
  transcript: "Transcript",
  trace: "Trace",
  timing: "Timing",
};
export const HANG_UP_LABELS: Record<HangUpWhen, string> = {
  goal_or_goodbye: "Goal met or goodbye said",
  goodbye: "Goodbye said",
  max_duration: "Max duration reached",
};

// Limits and patterns mirror the backend's scenarios domain (scenarios/domain.py).
export const WEIGHT_TOTAL = 100;
const MAX = {
  name: 160,
  tags: 20,
  tag: 40,
  context: 20000,
  personaName: 120,
  notes: 2000,
  goal: 5000,
  instructions: 10000,
  facts: 50,
  factKey: 80,
  factValue: 500,
  criteria: 30,
  criterionText: 500,
} as const;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,100}$/;
const WHOLE = /^\d+$/;

const text = (max: number, required?: string) => {
  const base = z.string().trim();
  return (required ? base.min(1, required) : base).max(max, `Use at most ${max} characters.`);
};

/** A whole number within bounds, typed as text. */
const whole = (min: number, max: number, message: string) =>
  z.string().trim().refine((value) => WHOLE.test(value) && Number(value) >= min && Number(value) <= max, message);

/** The tags as the backend stores them: trimmed, non-empty, first occurrence only. */
export function parseTags(value: string): string[] {
  return [...new Set(value.split(",").map((tag) => tag.trim()).filter(Boolean))];
}

/** Sum of the weights that are whole numbers (others count as 0 until fixed). */
export function weightTotal(criteria: { weight: string }[]): number {
  return criteria.reduce((sum, { weight }) => sum + (WHOLE.test(weight.trim()) ? Number(weight) : 0), 0);
}

export const weightTotalMessage = (total: number) =>
  `Weights must total exactly ${WEIGHT_TOTAL}; they total ${total}.`;

export const scenarioFormSchema = z
  .object({
    agentId: z.string().min(1, "Choose the agent under test."),
    name: text(MAX.name, "Enter a name."),
    tags: z.string(),
    context: text(MAX.context),
    persona: z.object({
      name: text(MAX.personaName, "Enter the persona's name."),
      locale: z.string().trim().max(35, "Use at most 35 characters.").regex(LOCALE, "Use a language tag like es-MX."),
      temperament: z.enum(TEMPERAMENTS),
      notes: text(MAX.notes),
    }),
    ttsConnectionId: z.string(),
    voiceOverride: z
      .string()
      .trim()
      .refine((value) => !value || IDENTIFIER.test(value), "Use only letters, digits and . _ : - (up to 100 characters)."),
    goal: text(MAX.goal, "Describe what the caller wants."),
    instructions: text(MAX.instructions),
    facts: z
      .array(z.object({ key: text(MAX.factKey, "Enter a key."), value: text(MAX.factValue, "Enter a value.") }))
      .max(MAX.facts, `Use at most ${MAX.facts} facts.`),
    criteria: z
      .array(
        z.object({
          criterionId: z.string(),
          text: text(MAX.criterionText, "Describe the criterion."),
          kind: z.enum(CRITERION_KINDS),
          source: z.enum(EVIDENCE_SOURCES),
          weight: whole(1, WEIGHT_TOTAL, "Use a whole number from 1 to 100."),
        }),
      )
      .min(1, "Add at least one criterion.")
      .max(MAX.criteria, `Use at most ${MAX.criteria} criteria.`),
    endConditions: z.object({
      maxDurationS: whole(30, 1800, "Use a whole number of seconds from 30 to 1800."),
      maxSilenceS: whole(5, 120, "Use a whole number of seconds from 5 to 120."),
      hangUpWhen: z.enum(HANG_UP_RULES),
    }),
  })
  .superRefine((values, ctx) => {
    const tags = parseTags(values.tags);
    if (tags.length > MAX.tags) ctx.addIssue({ code: "custom", path: ["tags"], message: `Use at most ${MAX.tags} tags.` });
    if (tags.some((tag) => tag.length > MAX.tag)) {
      ctx.addIssue({ code: "custom", path: ["tags"], message: `Keep each tag within ${MAX.tag} characters.` });
    }
    const seen = new Set<string>();
    values.facts.forEach((fact, index) => {
      const key = fact.key.trim().toLowerCase();
      if (key && seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["facts", index, "key"], message: "Each fact needs a different key." });
      }
      seen.add(key);
    });
    const total = weightTotal(values.criteria);
    if (values.criteria.length > 0 && total !== WEIGHT_TOTAL) {
      ctx.addIssue({ code: "custom", path: ["criteria"], message: weightTotalMessage(total) });
    }
  });

export function newCriterion(weight = ""): ScenarioFormValues["criteria"][number] {
  return { criterionId: "", text: "", kind: "must", source: "transcript", weight };
}

/** Initial values: blank with the backend's defaults on create, the stored scenario on edit. */
export function initialValues(scenario: Scenario | undefined, defaultAgentId = ""): ScenarioFormValues {
  if (!scenario) {
    return {
      agentId: defaultAgentId,
      name: "",
      tags: "",
      context: "",
      persona: { name: "", locale: "es-MX", temperament: "polite", notes: "" },
      ttsConnectionId: "",
      voiceOverride: "",
      goal: "",
      instructions: "",
      facts: [],
      criteria: [newCriterion(String(WEIGHT_TOTAL))],
      endConditions: { maxDurationS: "360", maxSilenceS: "15", hangUpWhen: "goal_or_goodbye" },
    };
  }
  return {
    agentId: scenario.agentId,
    name: scenario.name,
    tags: scenario.tags.join(", "),
    context: scenario.context,
    persona: { ...scenario.persona },
    ttsConnectionId: scenario.ttsConnectionId ?? "",
    voiceOverride: scenario.voiceOverride ?? "",
    goal: scenario.goal,
    instructions: scenario.instructions,
    facts: scenario.facts.map((fact) => ({ ...fact })),
    criteria: scenario.criteria.map(({ id, text, kind, source, weight }) => ({
      criterionId: id,
      text,
      kind,
      source,
      weight: String(weight),
    })),
    endConditions: {
      maxDurationS: String(scenario.endConditions.maxDurationS),
      maxSilenceS: String(scenario.endConditions.maxSilenceS),
      hangUpWhen: scenario.endConditions.hangUpWhen,
    },
  };
}

export function toNewScenario(values: ScenarioFormValues): NewScenario {
  return {
    agentId: values.agentId,
    name: values.name.trim(),
    tags: parseTags(values.tags),
    context: values.context.trim(),
    persona: {
      name: values.persona.name.trim(),
      locale: values.persona.locale.trim(),
      temperament: values.persona.temperament,
      notes: values.persona.notes.trim(),
    },
    ttsConnectionId: values.ttsConnectionId || null,
    voiceOverride: values.voiceOverride.trim() || null,
    goal: values.goal.trim(),
    instructions: values.instructions.trim(),
    facts: values.facts.map((fact) => ({ key: fact.key.trim(), value: fact.value.trim() })),
    criteria: values.criteria.map(({ criterionId, text, kind, source, weight }) => ({
      ...(criterionId ? { id: criterionId } : {}),
      text: text.trim(),
      kind,
      source,
      weight: Number(weight),
    })),
    endConditions: {
      maxDurationS: Number(values.endConditions.maxDurationS),
      maxSilenceS: Number(values.endConditions.maxSilenceS),
      hangUpWhen: values.endConditions.hangUpWhen,
    },
  };
}

/**
 * Only the top-level fields that differ from the stored scenario. Structured fields (persona,
 * facts, criteria, end conditions) are sent whole, as the backend replaces them whole.
 */
export function toChanges(scenario: Scenario, values: ScenarioFormValues): ScenarioChanges {
  const stored = toNewScenario(initialValues(scenario));
  const next = toNewScenario(values);
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof NewScenario)[]) {
    if (JSON.stringify(next[key]) !== JSON.stringify(stored[key])) changes[key] = next[key];
  }
  return changes as ScenarioChanges;
}
