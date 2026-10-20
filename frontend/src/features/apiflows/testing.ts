import { http, HttpResponse } from "msw/http";
import { apiUrl, server } from "@/test/server";
import type { Api, Flow, FlowStep, NamedRef } from "./types";

/** A stored API as `/api/apis` returns it (flow count and agents follow `mockApisApi`'s flows). */
export function apiFixture(overrides: Partial<Api> = {}): Api {
  return {
    id: "api-shop",
    name: "Shop API",
    description: "Products and orders of the demo shop.",
    tags: ["shop"],
    baseUrl: "https://shop.example.com/v1",
    headers: [{ name: "Accept", value: "application/json" }],
    secrets: [{ name: "apiKey", hint: "••••7890" }],
    flowCount: 0,
    agents: [],
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
    ...overrides,
  };
}

/** A stored flow as `/api/flows` returns it. */
export function flowFixture(overrides: Partial<Flow> = {}): Flow {
  return {
    id: "f-products",
    apiId: "api-shop",
    api: { id: "api-shop", name: "Shop API" },
    name: "Search products",
    description: "Logs in with the API key, then searches the catalog.",
    inputs: [],
    steps: [
      {
        title: "Get a token",
        method: "POST",
        path: "/auth/token",
        query: [],
        headers: [],
        body: { key: "{{secret.apiKey}}" },
        saves: [{ name: "token", path: "body.access_token" }],
        checks: [{ type: "status", equals: 200 }],
      },
      {
        title: "Search",
        method: "GET",
        path: "/products",
        query: [{ name: "q", value: "shoes" }],
        headers: [{ name: "Authorization", value: "Bearer {{saved.token}}" }],
        body: null,
        saves: [],
        checks: [],
      },
    ],
    agents: [],
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
    ...overrides,
  };
}

export type RecordedRequest = { method: string; path: string; body: unknown };
type Body = Record<string, unknown>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "host.docker.internal"]);

/** Like the backend: https, or http only to a local host. */
function baseUrlProblem(value: unknown): string | undefined {
  try {
    const url = new URL(String(value));
    if (url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) return undefined;
    return "Value error, use https, or http only to localhost, 127.0.0.1 or host.docker.internal";
  } catch {
    return "Value error, enter an absolute URL";
  }
}

/** Like the backend: a mask and, for values of 8+ characters, the last 4. */
const hintOf = (value: string) => (value.length >= 8 ? `••••${value.slice(-4)}` : "••••");

/**
 * In-memory backend for `/api/apis` and `/api/flows`: 404/409/422 like the backend, secrets kept
 * in clear only here (`secrets`, by API id) and masked in every response, and every request
 * recorded (reads too, so tests can assert when the secrets were fetched).
 */
export function mockApisApi(
  initial: Api[] = [],
  options: {
    flows?: Flow[];
    secrets?: Record<string, Record<string, string>>;
    /** Agents a flow can name in `agentIds` (their names come back in `agents`). */
    agents?: NamedRef[];
  } = {},
) {
  const state = {
    items: [...initial],
    flows: [...(options.flows ?? [])],
    secrets: Object.fromEntries(
      initial.map((item) => [item.id, { ...Object.fromEntries(item.secrets.map((s) => [s.name, `value-of-${s.name}`])), ...options.secrets?.[item.id] }]),
    ) as Record<string, Record<string, string>>,
    requests: [] as RecordedRequest[],
  };
  let created = 0;
  let createdFlows = 0;
  const record = async (request: Request) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    state.requests.push({ method: request.method, path: new URL(request.url).pathname.replace(/^\/api/, ""), body });
    return (body ?? {}) as Body;
  };
  const view = (item: Api): Api => {
    const flows = state.flows.filter((flow) => flow.apiId === item.id);
    const agents = [...new Map(flows.flatMap((flow) => flow.agents).map((agent) => [agent.id, agent])).values()];
    const secrets = Object.entries(state.secrets[item.id] ?? {}).map(([name, value]) => ({ name, hint: hintOf(value) }));
    return { ...item, flowCount: flows.length, agents, secrets };
  };
  const notFound = () => HttpResponse.json({ detail: "API not found" }, { status: 404 });
  const taken = (name: unknown, except?: string) => state.items.some((item) => item.name === name && item.id !== except);
  const invalid = (body: Body) => {
    const problem = body.baseUrl === undefined ? undefined : baseUrlProblem(body.baseUrl);
    return problem
      ? HttpResponse.json({ detail: [{ type: "value_error", loc: ["body", "baseUrl"], msg: problem }] }, { status: 422 })
      : undefined;
  };

  const flowNotFound = () => HttpResponse.json({ detail: "Flow not found" }, { status: 404 });
  const flowTaken = (apiId: unknown, name: unknown, except?: string) =>
    state.flows.some((flow) => flow.apiId === apiId && flow.name === name && flow.id !== except);
  const agentsOf = (ids: unknown) =>
    ((ids as string[] | undefined) ?? []).map((id) => options.agents?.find((agent) => agent.id === id) ?? { id, name: id });
  // Like the backend's reference check, for `{{saved.x}}` in query and header values.
  const refused = (steps: FlowStep[] | undefined) => {
    const saved = new Set<string>();
    const detail: { type: string; loc: (string | number)[]; msg: string }[] = [];
    (steps ?? []).forEach((step, n) => {
      (["query", "headers"] as const).forEach((list) =>
        step[list].forEach((row, j) => {
          for (const match of row.value.matchAll(/\{\{\s*saved\.(\w+)\s*\}\}/g)) {
            if (!saved.has(match[1])) {
              detail.push({ type: "value_error", loc: ["body", "steps", n, list, j, "value"], msg: `no step saves '${match[1]}'` });
            }
          }
        }),
      );
      step.saves.forEach((save) => saved.add(save.name));
    });
    return detail.length > 0 ? HttpResponse.json({ detail }, { status: 422 }) : undefined;
  };

  server.use(
    http.get(apiUrl("/apis"), async ({ request }) => {
      await record(request);
      return HttpResponse.json([...state.items].sort((a, b) => a.name.localeCompare(b.name)).map(view));
    }),
    http.get(apiUrl("/apis/:id"), async ({ request, params }) => {
      await record(request);
      const found = state.items.find((item) => item.id === params.id);
      return found ? HttpResponse.json(view(found)) : notFound();
    }),
    http.get(apiUrl("/apis/:id/secrets"), async ({ request, params }) => {
      await record(request);
      const found = state.items.find((item) => item.id === params.id);
      return found ? HttpResponse.json({ secrets: { ...state.secrets[found.id] } }) : notFound();
    }),
    http.post(apiUrl("/apis"), async ({ request }) => {
      const body = await record(request);
      if (taken(body.name)) return HttpResponse.json({ detail: "API name already in use" }, { status: 409 });
      const refused = invalid(body);
      if (refused) return refused;
      const now = new Date().toISOString();
      const item = apiFixture({
        id: `api-new-${(created += 1)}`,
        name: String(body.name),
        description: String(body.description ?? ""),
        tags: (body.tags as string[] | undefined) ?? [],
        baseUrl: String(body.baseUrl),
        headers: (body.headers as Api["headers"] | undefined) ?? [],
        createdAt: now,
        updatedAt: now,
      });
      state.items.push(item);
      state.secrets[item.id] = { ...((body.secrets as Record<string, string> | undefined) ?? {}) };
      return HttpResponse.json(view(item), { status: 201 });
    }),
    http.patch(apiUrl("/apis/:id"), async ({ request, params }) => {
      const id = String(params.id);
      const body = await record(request);
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) return notFound();
      if (body.name !== undefined && taken(body.name, id)) {
        return HttpResponse.json({ detail: "API name already in use" }, { status: 409 });
      }
      const refused = invalid(body);
      if (refused) return refused;
      const { secrets, ...rest } = body as Partial<Api> & { secrets?: Record<string, string | null> };
      for (const [name, value] of Object.entries(secrets ?? {})) {
        if (value === null) delete state.secrets[id][name];
        else state.secrets[id][name] = value;
      }
      state.items[index] = { ...state.items[index], ...rest, updatedAt: new Date().toISOString() };
      return HttpResponse.json(view(state.items[index]));
    }),
    http.delete(apiUrl("/apis/:id"), async ({ request, params }) => {
      const id = String(params.id);
      await record(request);
      const found = state.items.find((item) => item.id === id);
      if (!found) return notFound();
      const count = view(found).flowCount;
      if (count > 0) {
        return HttpResponse.json({ detail: `API holds ${count} flow(s); move or delete them first` }, { status: 409 });
      }
      state.items = state.items.filter((item) => item.id !== id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(apiUrl("/flows"), async ({ request }) => {
      await record(request);
      const apiId = new URL(request.url).searchParams.get("apiId");
      return HttpResponse.json(state.flows.filter((flow) => !apiId || flow.apiId === apiId));
    }),
    http.post(apiUrl("/flows"), async ({ request }) => {
      const body = await record(request);
      const api = state.items.find((item) => item.id === body.apiId);
      if (!api) return notFound();
      if (flowTaken(body.apiId, body.name)) return HttpResponse.json({ detail: "Flow name already in use" }, { status: 409 });
      const invalid = refused(body.steps as FlowStep[]);
      if (invalid) return invalid;
      const now = new Date().toISOString();
      const flow = flowFixture({
        id: `f-new-${(createdFlows += 1)}`,
        apiId: api.id,
        api: { id: api.id, name: api.name },
        name: String(body.name),
        description: String(body.description ?? ""),
        inputs: (body.inputs as Flow["inputs"] | undefined) ?? [],
        steps: body.steps as FlowStep[],
        agents: agentsOf(body.agentIds),
        createdAt: now,
        updatedAt: now,
      });
      state.flows.push(flow);
      return HttpResponse.json(flow, { status: 201 });
    }),
    http.patch(apiUrl("/flows/:id"), async ({ request, params }) => {
      const id = String(params.id);
      const body = await record(request);
      const index = state.flows.findIndex((flow) => flow.id === id);
      if (index < 0) return flowNotFound();
      if (body.name !== undefined && flowTaken(state.flows[index].apiId, body.name, id)) {
        return HttpResponse.json({ detail: "Flow name already in use" }, { status: 409 });
      }
      const invalid = refused(body.steps as FlowStep[] | undefined);
      if (invalid) return invalid;
      const { agentIds, ...rest } = body;
      state.flows[index] = {
        ...state.flows[index],
        ...(rest as Partial<Flow>),
        ...(agentIds === undefined ? {} : { agents: agentsOf(agentIds) }),
        updatedAt: new Date(Date.now() + state.requests.length).toISOString(),
      };
      return HttpResponse.json(state.flows[index]);
    }),
    http.delete(apiUrl("/flows/:id"), async ({ request, params }) => {
      await record(request);
      if (!state.flows.some((flow) => flow.id === params.id)) return flowNotFound();
      state.flows = state.flows.filter((flow) => flow.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.get(apiUrl("/flows/:id/curl"), async ({ request, params }) => {
      await record(request);
      const flow = state.flows.find((item) => item.id === params.id);
      if (!flow) return flowNotFound();
      const base = state.items.find((item) => item.id === flow.apiId)?.baseUrl ?? "";
      return HttpResponse.json({
        steps: flow.steps.map((step) => ({ curl: `curl -X ${step.method} '${base}${step.path}'` })),
      });
    }),
  );
  return state;
}
