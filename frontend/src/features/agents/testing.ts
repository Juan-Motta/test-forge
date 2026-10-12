import { http, HttpResponse } from "msw/http";
import { apiUrl, server } from "@/test/server";
import type { Agent, AgentConnectionTest, AgentProtocol } from "./types";

/** A stored agent as the API returns it. */
export function agentFixture(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a-hotel",
    name: "Hotel booking assistant",
    context: "Voice receptionist of Hotel Mirador. Books, changes and cancels reservations.",
    protocol: "realtime",
    baseUrl: "wss://agent.example.com/ws",
    channelId: "hotel-dev",
    userId: "user|KSG|42",
    origin: null,
    langfuseConnectionId: null,
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
    ...overrides,
  };
}

export type RecordedRequest = { method: string; path: string; body: unknown };

type MockOptions = {
  /** How many scenarios reference an agent; a positive count makes DELETE answer 409. */
  scenarioCount?: (agentId: string) => number;
  /** Answer of `POST /agents/{id}/test`; a `Response` is returned as is (e.g. a 500). */
  connectionTest?: (agentId: string) => AgentConnectionTest | Response;
};

/** A reachable agent's connection check, as `POST /api/agents/{id}/test` returns it. */
export function connectionTestFixture(overrides: Partial<AgentConnectionTest> = {}): AgentConnectionTest {
  return {
    reachable: true,
    latencyMs: 142,
    protocol: "realtime",
    log: [
      { ok: true, message: "Connected to wss://agent.example.com/ws" },
      { ok: true, message: "Detected the realtime protocol" },
      { ok: true, message: "Session ready in 142 ms" },
    ],
    ...overrides,
  };
}

const nameTaken = () => HttpResponse.json({ detail: "Agent name already in use" }, { status: 409 });
const notFound = () => HttpResponse.json({ detail: "Agent not found" }, { status: 404 });

/**
 * In-memory backend for `/api/agents`: keeps state across calls, answers 404/409 like the
 * backend, and records every request but list reads so tests can assert exact payloads.
 */
export function mockAgentsApi(initial: Agent[] = [], options: MockOptions = {}) {
  const state = { items: [...initial], requests: [] as RecordedRequest[] };
  let created = 0; // ids are never reused, even after a delete
  const record = async (request: Request, path: string) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    state.requests.push({ method: request.method, path, body });
    return (body ?? {}) as Record<string, unknown>;
  };
  const taken = (name: unknown, except?: string) =>
    state.items.some((item) => item.name === name && item.id !== except);

  server.use(
    http.get(apiUrl("/agents"), () =>
      HttpResponse.json([...state.items].sort((a, b) => a.name.localeCompare(b.name))),
    ),
    http.post(apiUrl("/agents"), async ({ request }) => {
      const body = await record(request, "/agents");
      if (taken(body.name)) return nameTaken();
      const now = new Date().toISOString();
      created += 1;
      const agent: Agent = {
        id: `a-new-${created}`,
        name: String(body.name),
        context: String(body.context ?? ""),
        protocol: (body.protocol ?? "auto") as AgentProtocol,
        baseUrl: String(body.baseUrl),
        channelId: String(body.channelId),
        userId: String(body.userId),
        origin: (body.origin as string | null | undefined) ?? null,
        langfuseConnectionId: (body.langfuseConnectionId as string | null | undefined) ?? null,
        createdAt: now,
        updatedAt: now,
      };
      state.items.push(agent);
      return HttpResponse.json(agent, { status: 201 });
    }),
    http.patch(apiUrl("/agents/:id"), async ({ request, params }) => {
      const id = String(params.id);
      const body = await record(request, `/agents/${id}`);
      const index = state.items.findIndex((item) => item.id === id);
      if (index < 0) return notFound();
      if (body.name !== undefined && taken(body.name, id)) return nameTaken();
      state.items[index] = { ...state.items[index], ...(body as Partial<Agent>), updatedAt: new Date().toISOString() };
      return HttpResponse.json(state.items[index]);
    }),
    http.delete(apiUrl("/agents/:id"), async ({ request, params }) => {
      const id = String(params.id);
      await record(request, `/agents/${id}`);
      if (!state.items.some((item) => item.id === id)) return notFound();
      const used = options.scenarioCount?.(id) ?? 0;
      if (used > 0) return HttpResponse.json({ detail: `Agent is used by ${used} scenario(s)` }, { status: 409 });
      state.items = state.items.filter((item) => item.id !== id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(apiUrl("/agents/:id/test"), async ({ request, params }) => {
      const id = String(params.id);
      await record(request, `/agents/${id}/test`);
      if (!state.items.some((item) => item.id === id)) return notFound();
      const result = options.connectionTest?.(id) ?? connectionTestFixture();
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
  return state;
}
