import { http, HttpResponse } from "msw/http";
import { apiUrl, server } from "@/test/server";
import type { Api, Flow, FlowRun, FlowRunSummary, FlowStep, NamedRef, RunInputs, StepRun } from "./types";

/** A stored API as `/api/apis` returns it (flow count and agents follow `mockApisApi`'s flows). */
export function apiFixture(overrides: Partial<Api> = {}): Api {
  return {
    id: "api-shop",
    name: "Shop API",
    description: "Products and orders of the demo shop.",
    tags: ["shop"],
    baseUrl: "https://shop.example.com/v1",
    headers: [{ name: "Accept", value: "application/json" }],
    variables: {},
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
    lastRun: null,
    ...overrides,
  };
}

/** A run of `flowFixture()` as `GET /api/flow-runs` lists it. */
export function flowRunSummaryFixture(overrides: Partial<FlowRunSummary> = {}): FlowRunSummary {
  return {
    id: "run-1",
    flowId: "f-products",
    flowName: "Search products",
    apiId: "api-shop",
    apiName: "Shop API",
    status: "failed",
    stepCount: 2,
    durationMs: 2430,
    createdAt: "2026-10-20T09:00:00Z",
    ...overrides,
  };
}

/**
 * `GET /api/flow-runs` over these summaries: newest first, filtered by `status` and `apiId`,
 * paginated by `limit`/`offset`. Records each query string (without the `?`).
 */
export function mockFlowRunSummaries(summaries: FlowRunSummary[]) {
  const queries: string[] = [];
  server.use(
    http.get(apiUrl("/flow-runs"), ({ request }) => {
      const params = new URL(request.url).searchParams;
      queries.push(params.toString());
      const status = params.get("status");
      const apiId = params.get("apiId");
      const limit = Number(params.get("limit") ?? 50);
      const offset = Number(params.get("offset") ?? 0);
      const matching = summaries
        .filter((run) => (!status || run.status === status) && (!apiId || run.apiId === apiId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return HttpResponse.json({ items: matching.slice(offset, offset + limit), total: matching.length });
    }),
  );
  return queries;
}

/** A stored run of `flowFixture()`: the token step passed, the search step failed its check. */
export function runFixture(overrides: Partial<FlowRun> = {}): FlowRun {
  const steps: StepRun[] = [
    {
      index: 0,
      title: "Get a token",
      status: "passed",
      request: {
        method: "POST",
        url: "https://shop.example.com/v1/auth/token",
        headers: [
          { name: "Accept", value: "application/json" },
          { name: "X-Key", value: "{{secret.apiKey}}" },
        ],
        body: { key: "{{secret.apiKey}}" },
      },
      response: {
        status: 200,
        headers: [{ name: "content-type", value: "application/json" }],
        body: { access_token: "tok-1", expires_in: 3600 },
        sizeBytes: 48,
      },
      durationMs: 120,
      saved: { token: "tok-1" },
      checks: [{ check: { type: "status", equals: 200 }, passed: true, actual: 200 }],
      error: null,
    },
    {
      index: 1,
      title: "Search",
      status: "failed",
      request: {
        method: "GET",
        url: "https://shop.example.com/v1/products?q=shoes",
        headers: [{ name: "Authorization", value: "Bearer tok-1" }],
        body: null,
      },
      response: { status: 500, headers: [{ name: "content-type", value: "text/plain" }], body: "Internal error", sizeBytes: 14 },
      durationMs: 80,
      saved: {},
      checks: [{ check: { type: "status", equals: 200 }, passed: false, actual: 500 }],
      error: null,
    },
  ];
  return {
    id: "run-1",
    flowId: "f-products",
    status: "failed",
    inputs: [{ name: "q", value: "shoes", source: "given" }],
    steps,
    durationMs: 2430,
    createdAt: "2026-10-20T09:00:00Z",
    ...overrides,
  };
}

/** `query` is the search string (`?limit=10`), present only when the URL has one. */
export type RecordedRequest = { method: string; path: string; query?: string; body: unknown };
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

const MAX_VARIABLES = 30;
const MAX_SECRETS = 10;

/** One 422 issue, as FastAPI writes it. */
const issue = (loc: (string | number)[], msg: string) => ({ type: "value_error", loc, msg });
const refuse = (detail: ReturnType<typeof issue>[]) => HttpResponse.json({ detail }, { status: 422 });

/**
 * Like the backend: a name is a variable or a secret, never both (checked once every change of
 * the request is applied), and an API holds at most 30 variables and 10 secrets.
 */
function connectionProblem(variables: Record<string, string>, secrets: Record<string, string>) {
  if (Object.keys(secrets).length > MAX_SECRETS) return refuse([issue(["secrets"], `an API holds at most ${MAX_SECRETS} secrets`)]);
  if (Object.keys(variables).length > MAX_VARIABLES) {
    return refuse([issue(["variables"], `an API holds at most ${MAX_VARIABLES} variables`)]);
  }
  const both = Object.keys(variables).filter((name) => name in secrets).sort();
  return both.length > 0
    ? refuse(both.map((name) => issue(["body", "variables", name], `'${name}' is already a secret of this API`)))
    : undefined;
}

/** Applies `{name: value | null}` changes: a value sets that name, `null` removes it. */
function applied(current: Record<string, string>, changes: Record<string, string | null> | undefined) {
  const next = { ...current };
  for (const [name, value] of Object.entries(changes ?? {})) {
    if (value === null) delete next[name];
    else next[name] = value;
  }
  return next;
}

/** Like the backend: a mask and, for values of 8+ characters, the last 4. */
const hintOf = (value: string) => (value.length >= 8 ? `••••${value.slice(-4)}` : "••••");

/**
 * In-memory backend for `/api/apis` and `/api/flows`: 404/409/422 like the backend (a name both a
 * variable and a secret, too many of either, an unknown `{{var.x}}`), secrets kept
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
    /** Stored runs, newest first. */
    runs?: FlowRun[];
    /**
     * What `POST /flows/{id}/runs` answers: a run (stored and returned with 201) or an error
     * response. By default every step of the flow passes.
     */
    onRun?: (flow: Flow, inputs: RunInputs) => FlowRun | Response | Promise<FlowRun | Response>;
  } = {},
) {
  const state = {
    items: [...initial],
    flows: [...(options.flows ?? [])],
    secrets: Object.fromEntries(
      initial.map((item) => [item.id, { ...Object.fromEntries(item.secrets.map((s) => [s.name, `value-of-${s.name}`])), ...options.secrets?.[item.id] }]),
    ) as Record<string, Record<string, string>>,
    requests: [] as RecordedRequest[],
    runs: [...(options.runs ?? [])],
  };
  let createdRuns = 0;
  let created = 0;
  let createdFlows = 0;
  const record = async (request: Request) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    const url = new URL(request.url);
    state.requests.push({ method: request.method, path: url.pathname.replace(/^\/api/, ""), ...(url.search ? { query: url.search } : {}), body });
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
  // Like the backend's reference checks, for `{{saved.x}}` and `{{var.x}}` in query and header values.
  const refused = (steps: FlowStep[] | undefined, apiId: unknown) => {
    const api = state.items.find((item) => item.id === apiId);
    const known = new Set([...Object.keys(api?.variables ?? {}), ...Object.keys(state.secrets[String(apiId)] ?? {})]);
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
          for (const match of row.value.matchAll(/\{\{\s*var\.(\w+)\s*\}\}/g)) {
            if (!known.has(match[1])) {
              detail.push(issue(["body", "steps", n, list, j, "value"], `the API has no variable named '${match[1]}'`));
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
      const variables = (body.variables as Record<string, string> | undefined) ?? {};
      const secrets = (body.secrets as Record<string, string> | undefined) ?? {};
      const clash = connectionProblem(variables, secrets);
      if (clash) return clash;
      const now = new Date().toISOString();
      const item = apiFixture({
        id: `api-new-${(created += 1)}`,
        name: String(body.name),
        description: String(body.description ?? ""),
        tags: (body.tags as string[] | undefined) ?? [],
        baseUrl: String(body.baseUrl),
        headers: (body.headers as Api["headers"] | undefined) ?? [],
        variables,
        createdAt: now,
        updatedAt: now,
      });
      state.items.push(item);
      state.secrets[item.id] = { ...secrets };
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
      const { secrets, variables, ...rest } = body as Omit<Partial<Api>, "variables"> & {
        secrets?: Record<string, string | null>;
        variables?: Record<string, string | null>;
      };
      // Secrets, then variables, then the checks, as one change: nothing is kept when refused.
      const nextSecrets = applied(state.secrets[id] ?? {}, secrets);
      const nextVariables = applied(state.items[index].variables, variables);
      const problem = connectionProblem(nextVariables, nextSecrets);
      if (problem) return problem;
      state.secrets[id] = nextSecrets;
      state.items[index] = { ...state.items[index], ...rest, variables: nextVariables, updatedAt: new Date().toISOString() };
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
      const invalid = refused(body.steps as FlowStep[], api.id);
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
      const invalid = refused(body.steps as FlowStep[] | undefined, state.flows[index].apiId);
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
    http.post(apiUrl("/flows/:id/runs"), async ({ request, params }) => {
      const body = await record(request);
      const flow = state.flows.find((item) => item.id === params.id);
      if (!flow) return flowNotFound();
      const inputs = (body.inputs as RunInputs | undefined) ?? {};
      const answer = options.onRun
        ? await options.onRun(flow, inputs)
        : runFixture({
            flowId: flow.id,
            status: "passed",
            inputs: Object.entries(inputs).map(([name, value]) => ({ name, value, source: "given" as const })),
            steps: runFixture().steps.slice(0, flow.steps.length).map((step) => ({ ...step, status: "passed" as const })),
          });
      if (answer instanceof Response) return answer;
      const run = { ...answer, id: `run-new-${(createdRuns += 1)}`, flowId: flow.id };
      state.runs.unshift(run);
      return HttpResponse.json(run, { status: 201 });
    }),
    http.get(apiUrl("/flows/:id/runs"), async ({ request, params }) => {
      await record(request);
      const limit = Number(new URL(request.url).searchParams.get("limit") ?? 20);
      return HttpResponse.json(state.runs.filter((run) => run.flowId === params.id).slice(0, limit));
    }),
    http.get(apiUrl("/flow-runs/:id"), async ({ request, params }) => {
      await record(request);
      const run = state.runs.find((item) => item.id === params.id);
      return run ? HttpResponse.json(run) : HttpResponse.json({ detail: "Run not found" }, { status: 404 });
    }),
    http.get(apiUrl("/flow-runs/:id/steps/:index/curl"), async ({ request, params }) => {
      await record(request);
      const run = state.runs.find((item) => item.id === params.id);
      const step = run?.steps[Number(params.index)];
      if (!run || !step?.request) return HttpResponse.json({ detail: "Run not found" }, { status: 404 });
      const reveal = new URL(request.url).searchParams.get("reveal") === "true";
      const api = state.items.find((item) => state.flows.some((flow) => flow.id === run.flowId && flow.apiId === item.id));
      const secrets = state.secrets[api?.id ?? ""] ?? {};
      const curl = `curl -X ${step.request.method} '${step.request.url}'${step.request.headers.map((h) => ` -H '${h.name}: ${h.value}'`).join("")}`;
      return HttpResponse.json({
        curl: curl.replace(/\{\{\s*secret\.(\w+)\s*\}\}/g, (match, name: string) =>
          reveal ? (secrets[name] ?? match) : hintOf(secrets[name] ?? ""),
        ),
      });
    }),
  );
  return state;
}
