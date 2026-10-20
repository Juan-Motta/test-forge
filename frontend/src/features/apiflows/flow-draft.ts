import type { Flow, FlowCheck, FlowInput, FlowStep, HttpMethod } from "./types";

/**
 * The flow editor's working copy: text exactly as typed (numbers, JSON bodies and check values
 * included), with a `key` per row so React keeps rows apart while they move.
 */
export type PairDraft = { key: string; name: string; value: string };
export type SaveDraft = { key: string; name: string; path: string };
export type InputDraft = {
  key: string;
  name: string;
  type: FlowInput["type"];
  description: string;
  default: string;
  generate: string;
};
export type CheckType = FlowCheck["type"];
/** One shape for every check type, so switching the type keeps what was typed. */
export type CheckDraft = { key: string; type: CheckType; equals: string; path: string; op: string; value: string; maxMs: string };
export type StepDraft = {
  key: string;
  title: string;
  method: HttpMethod;
  path: string;
  query: PairDraft[];
  headers: PairDraft[];
  /** JSON text; empty means no body. */
  body: string;
  saves: SaveDraft[];
  checks: CheckDraft[];
};
export type FlowDraft = {
  name: string;
  description: string;
  inputs: InputDraft[];
  steps: StepDraft[];
  agentIds: string[];
};

/** What `POST /api/flows` (with `apiId`) and `PATCH /api/flows/{id}` take. */
export type FlowPayload = {
  name: string;
  description: string;
  inputs: FlowInput[];
  steps: FlowStep[];
  agentIds: string[];
};

export const METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
export const CHECK_OPS = ["exists", "==", "!=", ">", ">=", "<", "<="] as const;

let sequence = 0;
/** A key unique within the page. */
export const nextKey = () => `row-${(sequence += 1)}`;

export const newPair = (): PairDraft => ({ key: nextKey(), name: "", value: "" });
export const newSave = (): SaveDraft => ({ key: nextKey(), name: "", path: "" });
export const newInput = (): InputDraft => ({
  key: nextKey(),
  name: "",
  type: "text",
  description: "",
  default: "",
  generate: "",
});
export const newCheck = (type: CheckType = "status"): CheckDraft => ({
  key: nextKey(),
  type,
  equals: type === "status" ? "200" : "",
  path: "",
  op: "exists",
  value: "",
  maxMs: "",
});
/** "Add step": a GET of `/`. */
export const newStep = (): StepDraft => ({
  key: nextKey(),
  title: "",
  method: "GET",
  path: "/",
  query: [],
  headers: [],
  body: "",
  saves: [],
  checks: [],
});

const checkDraft = (check: FlowCheck): CheckDraft => {
  const draft = newCheck(check.type);
  if (check.type === "status") return { ...draft, equals: String(check.equals) };
  if (check.type === "duration") return { ...draft, maxMs: String(check.maxMs) };
  return { ...draft, path: check.path, op: check.op, value: check.value === null ? "" : String(check.value) };
};

/** The editor's copy of a stored flow, or of a new one (one GET step). */
export function draftOf(flow?: Flow): FlowDraft {
  if (!flow) return { name: "", description: "", inputs: [], steps: [newStep()], agentIds: [] };
  return {
    name: flow.name,
    description: flow.description,
    inputs: flow.inputs.map((input) => ({
      key: nextKey(),
      name: input.name,
      type: input.type,
      description: input.description,
      default: input.default ?? "",
      generate: input.generate ?? "",
    })),
    steps: flow.steps.map((step) => ({
      key: nextKey(),
      title: step.title,
      method: step.method,
      path: step.path,
      query: step.query.map((row) => ({ key: nextKey(), ...row })),
      headers: step.headers.map((row) => ({ key: nextKey(), ...row })),
      body: step.body === null || step.body === undefined ? "" : JSON.stringify(step.body, null, 2),
      saves: step.saves.map((row) => ({ key: nextKey(), ...row })),
      checks: step.checks.map(checkDraft),
    })),
    agentIds: flow.agents.map((agent) => agent.id),
  };
}

/** A whole number as a number; anything else as typed, so the backend names what is wrong. */
const whole = (text: string): number => (/^-?\d+$/.test(text.trim()) ? Number(text.trim()) : (text as unknown as number));

/** A check value: empty or `null` is none, `true`/`false` and numbers are typed, the rest is text. */
export function checkValue(text: string): string | number | boolean | null {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "null") return null;
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return text;
}

function checkOf(check: CheckDraft): FlowCheck {
  if (check.type === "status") return { type: "status", equals: whole(check.equals) };
  if (check.type === "duration") return { type: "duration", maxMs: whole(check.maxMs) };
  return { type: "path", path: check.path.trim(), op: check.op, value: check.op === "exists" ? null : checkValue(check.value) };
}

/**
 * The request body for a save, or the steps whose JSON body does not parse. Rows are sent as
 * they are (blank ones included) so the backend's error locations match the editor's rows.
 */
export function payloadOf(draft: FlowDraft): { payload: FlowPayload; invalidBodies: number[] } {
  const invalidBodies: number[] = [];
  const steps = draft.steps.map((step, index): FlowStep => {
    let body: unknown = null;
    if (step.body.trim()) {
      try {
        body = JSON.parse(step.body);
      } catch {
        invalidBodies.push(index);
      }
    }
    return {
      title: step.title.trim(),
      method: step.method,
      path: step.path.trim(),
      query: step.query.map(({ name, value }) => ({ name: name.trim(), value })),
      headers: step.headers.map(({ name, value }) => ({ name: name.trim(), value })),
      body,
      saves: step.saves.map(({ name, path }) => ({ name: name.trim(), path: path.trim() })),
      checks: step.checks.map(checkOf),
    };
  });
  return {
    payload: {
      name: draft.name.trim(),
      description: draft.description.trim(),
      inputs: draft.inputs.map((input) => ({
        name: input.name.trim(),
        type: input.type,
        description: input.description.trim(),
        default: input.default === "" ? null : input.default,
        generate: input.generate.trim() === "" ? null : input.generate.trim(),
      })),
      steps,
      agentIds: draft.agentIds,
    },
    invalidBodies,
  };
}

/** The list with the item at `index` moved one place up (-1) or down (+1); unchanged at the ends. */
export function moved<T>(items: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
