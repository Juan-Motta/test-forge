import { http, HttpResponse } from "msw/http";
import type { Agent } from "@/features/agents/types";
import { apiUrl, server } from "@/test/server";
import type { Criterion, Scenario } from "./types";

/** A stored scenario as the API returns it. */
export function scenarioFixture(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "s-booking",
    agentId: "a-hotel",
    agent: { id: "a-hotel", name: "Hotel booking assistant" },
    name: "Booking with date change",
    tags: ["booking", "regression"],
    context: "The caller already has a reservation number.",
    persona: { name: "Lucía", locale: "es-MX", temperament: "hurried", notes: "Interrupts sometimes." },
    ttsConnectionId: null,
    evaluatorConnectionId: null,
    voiceOverride: null,
    goal: "Book a double room for 3 nights from November 14.",
    instructions: "Do not give every detail at once.",
    facts: [
      { key: "Check-in", value: "2026-11-14" },
      { key: "Guests", value: "2 adults" },
    ],
    criteria: [
      { id: "k-1", text: "States the total price before confirming", kind: "must", source: "transcript", weight: 60 },
      { id: "k-2", text: "Reads back the confirmation code", kind: "should", source: "transcript", weight: 40 },
    ],
    endConditions: { maxDurationS: 360, maxSilenceS: 15, hangUpWhen: "goal_or_goodbye" },
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
    ...overrides,
  };
}

export type RecordedRequest = { method: string; path: string; body: unknown };
type Body = Record<string, unknown>;
type Issue = { type: string; loc: (string | number)[]; msg: string };

const notFound = () => HttpResponse.json({ detail: "Scenario not found" }, { status: 404 });
const nameTaken = () =>
  HttpResponse.json({ detail: "Scenario name already in use for this agent" }, { status: 409 });
const invalid = (detail: Issue[]) => HttpResponse.json({ detail }, { status: 422 });

/** The backend's cross-item rules: known agent, unique fact keys, criteria weights total 100. */
function issues(body: Body, agents: Agent[]): Issue[] {
  const found: Issue[] = [];
  if (body.agentId !== undefined && !agents.some((agent) => agent.id === body.agentId)) {
    found.push({ type: "value_error", loc: ["body", "agentId"], msg: "agent not found" });
  }
  const facts = body.facts as { key: string }[] | undefined;
  if (facts && new Set(facts.map((fact) => fact.key.toLowerCase())).size !== facts.length) {
    found.push({ type: "value_error", loc: ["body", "facts"], msg: "Value error, fact keys must be unique" });
  }
  const criteria = body.criteria as { weight: number }[] | undefined;
  const total = criteria?.reduce((sum, criterion) => sum + criterion.weight, 0);
  if (total !== undefined && total !== 100) {
    found.push({
      type: "value_error",
      loc: ["body", "criteria"],
      msg: `Value error, criteria weights must total 100 (they total ${total})`,
    });
  }
  return found;
}

/**
 * In-memory backend for `/api/scenarios`: filters, 404/409/422 and duplicate naming like the
 * backend, and records every request but reads so tests can assert exact payloads.
 */
export function mockScenariosApi(initial: Scenario[] = [], options: { agents?: Agent[] } = {}) {
  const agents = options.agents ?? [];
  const state = { items: [...initial], requests: [] as RecordedRequest[] };
  let created = 0;
  let criterionIds = 0;
  const record = async (request: Request, path: string) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    state.requests.push({ method: request.method, path, body });
    return (body ?? {}) as Body;
  };
  const agentSummary = (id: string) => ({ id, name: agents.find((agent) => agent.id === id)?.name ?? id });
  const taken = (agentId: string, name: string, except?: string) =>
    state.items.some((item) => item.agentId === agentId && item.name === name && item.id !== except);
  const withIds = (criteria: unknown) =>
    (criteria as Partial<Criterion>[]).map((criterion) => ({
      ...criterion,
      id: criterion.id ?? `k-new-${(criterionIds += 1)}`,
    })) as Criterion[];
  const newId = () => `s-new-${(created += 1)}`;

  server.use(
    http.get(apiUrl("/scenarios"), ({ request }) => {
      const params = new URL(request.url).searchParams;
      const agentId = params.get("agentId");
      const tag = params.get("tag");
      const list = state.items
        .filter((item) => (agentId ? item.agentId === agentId : true) && (tag ? item.tags.includes(tag) : true))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return HttpResponse.json(list);
    }),
    http.get(apiUrl("/scenarios/:id"), ({ params }) => {
      const found = state.items.find((item) => item.id === params.id);
      return found ? HttpResponse.json(found) : notFound();
    }),
    http.post(apiUrl("/scenarios"), async ({ request }) => {
      const body = await record(request, "/scenarios");
      const problems = issues(body, agents);
      if (problems.length > 0) return invalid(problems);
      if (taken(String(body.agentId), String(body.name))) return nameTaken();
      const now = new Date().toISOString();
      const scenario: Scenario = {
        ...(body as unknown as Scenario),
        id: newId(),
        agent: agentSummary(String(body.agentId)),
        criteria: withIds(body.criteria),
        createdAt: now,
        updatedAt: now,
      };
      state.items.push(scenario);
      return HttpResponse.json(scenario, { status: 201 });
    }),
    http.patch(apiUrl("/scenarios/:id"), async ({ request, params }) => {
      const id = String(params.id);
      const body = await record(request, `/scenarios/${id}`);
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) return notFound();
      const problems = issues(body, agents);
      if (problems.length > 0) return invalid(problems);
      const next = { ...state.items[index], ...(body as Partial<Scenario>) };
      if (taken(next.agentId, next.name, id)) return nameTaken();
      if (body.criteria) next.criteria = withIds(body.criteria);
      next.agent = agentSummary(next.agentId);
      next.updatedAt = new Date().toISOString();
      state.items[index] = next;
      return HttpResponse.json(next);
    }),
    http.delete(apiUrl("/scenarios/:id"), async ({ request, params }) => {
      const id = String(params.id);
      await record(request, `/scenarios/${id}`);
      if (!state.items.some((item) => item.id === id)) return notFound();
      state.items = state.items.filter((item) => item.id !== id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(apiUrl("/scenarios/:id/duplicate"), async ({ request, params }) => {
      const id = String(params.id);
      await record(request, `/scenarios/${id}/duplicate`);
      const source = state.items.find((item) => item.id === id);
      if (!source) return notFound();
      let n = 1;
      const copyName = () => `${source.name} (copy${n === 1 ? "" : ` ${n}`})`;
      while (taken(source.agentId, copyName())) n += 1;
      const now = new Date().toISOString();
      const copy: Scenario = { ...source, id: newId(), name: copyName(), createdAt: now, updatedAt: now };
      state.items.push(copy);
      return HttpResponse.json(copy, { status: 201 });
    }),
  );
  return state;
}
