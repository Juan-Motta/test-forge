import { idByName, parseTransfer, read, toTransferText } from "@/features/transfer/transfer";
import type { Translator } from "@/lib/i18n";
import { initialValues, type ScenarioFormValues } from "./form-schema";
import {
  CRITERION_KINDS,
  EVALUATOR_MODES,
  EVIDENCE_SOURCES,
  HANG_UP_RULES,
  REALTIME_MODELS,
  TEMPERAMENTS,
  type Scenario,
} from "./types";

type Named = { id: string; name: string };

const nameOf = (records: readonly Named[], id: string | null) => records.find((record) => record.id === id)?.name ?? null;

/**
 * A scenario as text. The agent and the connections travel by name (ids differ between
 * environments); criterion ids stay behind, so an import starts fresh results.
 */
export function scenarioToText(scenario: Scenario, connections: readonly Named[]): string {
  return toTransferText("scenario", {
    agent: scenario.agent.name,
    name: scenario.name,
    tags: scenario.tags,
    context: scenario.context,
    persona: scenario.persona,
    ttsConnection: nameOf(connections, scenario.ttsConnectionId),
    evaluatorConnection: nameOf(connections, scenario.evaluatorConnectionId),
    voiceOverride: scenario.voiceOverride,
    evaluatorMode: scenario.evaluatorMode ?? "pipeline",
    realtimeModel: scenario.realtimeModel ?? REALTIME_MODELS[0],
    goal: scenario.goal,
    instructions: scenario.instructions,
    facts: scenario.facts,
    criteria: scenario.criteria.map(({ text, kind, source, weight }) => ({ text, kind, source, weight })),
    endConditions: scenario.endConditions,
    interruptions: scenario.interruptions,
  });
}

export type ScenarioImport = { ok: true; values: ScenarioFormValues; notes: string[] } | { ok: false; error: string };

/**
 * Form values for a new scenario from an exported one. Mistyped or unknown fields keep the new
 * form's defaults; the agent and connections are matched by name, and the ones this server lacks
 * are listed in `notes` (the user picks them before saving).
 */
export function scenarioFromText(
  t: Translator,
  text: string,
  agents: readonly Named[],
  connections: readonly Named[],
  defaultAgentId = "",
): ScenarioImport {
  const parsed = parseTransfer(text, "scenario");
  if (!parsed.ok) return { ok: false, error: t(`transfer.error.${parsed.error}`, { kind: t("transfer.kind.scenario") }) };
  const data = parsed.data;
  const blank = initialValues(undefined, defaultAgentId);
  const persona = read.object(data.persona);
  const ends = read.object(data.endConditions);
  const agentId = idByName(agents, data.agent) ?? defaultAgentId;
  const ttsConnectionId = idByName(connections, data.ttsConnection) ?? null;
  const evaluatorConnectionId = idByName(connections, data.evaluatorConnection) ?? null;

  const scenario: Scenario = {
    id: "",
    agentId,
    agent: { id: agentId, name: "" },
    name: read.string(data.name) ?? "",
    tags: read.array(data.tags).filter((tag): tag is string => typeof tag === "string"),
    context: read.string(data.context) ?? "",
    persona: {
      name: read.string(persona.name) ?? "",
      locale: read.string(persona.locale) ?? blank.persona.locale,
      temperament: read.oneOf(TEMPERAMENTS, persona.temperament) ?? blank.persona.temperament,
      notes: read.string(persona.notes) ?? "",
    },
    ttsConnectionId,
    evaluatorConnectionId,
    voiceOverride: read.string(data.voiceOverride) ?? null,
    evaluatorMode: read.oneOf(EVALUATOR_MODES, data.evaluatorMode) ?? blank.evaluatorMode,
    realtimeModel: read.oneOf(REALTIME_MODELS, data.realtimeModel) ?? blank.realtimeModel,
    goal: read.string(data.goal) ?? "",
    instructions: read.string(data.instructions) ?? "",
    facts: read.array(data.facts).map((fact) => {
      const row = read.object(fact);
      return { key: read.string(row.key) ?? "", value: read.string(row.value) ?? "" };
    }),
    criteria: read.array(data.criteria).map((criterion) => {
      const row = read.object(criterion);
      return {
        id: "",
        text: read.string(row.text) ?? "",
        kind: read.oneOf(CRITERION_KINDS, row.kind) ?? "must",
        source: read.oneOf(EVIDENCE_SOURCES, row.source) ?? "transcript",
        weight: read.number(row.weight) ?? 0,
      };
    }),
    endConditions: {
      maxDurationS: read.number(ends.maxDurationS) ?? Number(blank.endConditions.maxDurationS),
      maxSilenceS: read.number(ends.maxSilenceS) ?? Number(blank.endConditions.maxSilenceS),
      maxTurns: read.number(ends.maxTurns) ?? Number(blank.endConditions.maxTurns),
      hangUpWhen: read.oneOf(HANG_UP_RULES, ends.hangUpWhen) ?? blank.endConditions.hangUpWhen,
    },
    interruptions: read.array(data.interruptions).map((interruption) => {
      const row = read.object(interruption);
      return { agentTurn: read.number(row.agentTurn) ?? 1, afterMs: read.number(row.afterMs) ?? 3000 };
    }),
    createdAt: "",
    updatedAt: "",
  };
  const values = initialValues(scenario);
  if (values.criteria.length === 0) values.criteria = blank.criteria;

  const notes: string[] = [];
  const missing = (name: unknown, found: unknown, key: "transfer.note.missingAgent" | "transfer.note.missingConnection") => {
    const wanted = read.string(name)?.trim();
    if (wanted && !found) notes.push(t(key, { name: wanted }));
  };
  missing(data.agent, idByName(agents, data.agent), "transfer.note.missingAgent");
  missing(data.ttsConnection, ttsConnectionId, "transfer.note.missingConnection");
  missing(data.evaluatorConnection, evaluatorConnectionId, "transfer.note.missingConnection");
  return { ok: true, values, notes };
}
