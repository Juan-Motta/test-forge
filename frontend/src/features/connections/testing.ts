import { http, HttpResponse } from "msw/http";
import { apiUrl, server } from "@/test/server";
import type { Connection, ConnectionKind, LastTest } from "./types";

/** A stored connection as the API returns it. */
export function connectionFixture(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "c-openai",
    name: "OpenAI prod",
    kind: "openai",
    config: { baseUrl: "https://api.openai.com/v1", ttsModel: "gpt-4o-mini-tts", ttsVoice: "alloy" },
    secretHint: "••••3a1c",
    hasSecret: true,
    lastTest: null,
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-02T10:00:00Z",
    ...overrides,
  };
}

export type RecordedRequest = { method: string; path: string; body: unknown };

type MockOptions = {
  /** Result of `POST /connections/test` (draft). */
  draftResult?: LastTest;
  /** Result of `POST /connections/{id}/test` (stored). */
  storedResult?: LastTest;
};

function hint(secrets: unknown): string {
  const value = Object.values((secrets ?? {}) as Record<string, string>)[0] ?? "";
  return `••••${value.length >= 12 ? value.slice(-4) : ""}`;
}

/**
 * In-memory backend for `/api/connections`: keeps state across calls and records every request
 * (except list reads) so tests can assert the exact payloads the UI sent.
 */
export function mockConnectionsApi(initial: Connection[] = [], options: MockOptions = {}) {
  const state = { items: [...initial], requests: [] as RecordedRequest[] };
  let created = 0; // ids are never reused, even after a delete
  const record = async (request: Request, path: string) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    state.requests.push({ method: request.method, path, body });
    return body as Record<string, unknown> | undefined;
  };
  const passed: LastTest = { at: new Date().toISOString(), ok: true, detail: "HTTP 200: credentials accepted" };

  server.use(
    http.get(apiUrl("/connections"), () => HttpResponse.json(state.items)),
    http.post(apiUrl("/connections"), async ({ request }) => {
      const body = (await record(request, "/connections")) ?? {};
      const now = new Date().toISOString();
      created += 1;
      const connection: Connection = {
        id: `c-new-${created}`,
        name: String(body.name),
        kind: body.kind as ConnectionKind,
        config: (body.config ?? {}) as Record<string, unknown>,
        secretHint: hint(body.secrets),
        hasSecret: true,
        lastTest: null,
        createdAt: now,
        updatedAt: now,
      };
      state.items.push(connection);
      return HttpResponse.json(connection, { status: 201 });
    }),
    http.post(apiUrl("/connections/test"), async ({ request }) => {
      await record(request, "/connections/test");
      return HttpResponse.json(options.draftResult ?? passed);
    }),
    http.patch(apiUrl("/connections/:id"), async ({ request, params }) => {
      const body = (await record(request, `/connections/${String(params.id)}`)) ?? {};
      const index = state.items.findIndex((item) => item.id === params.id);
      if (index < 0) return HttpResponse.json({ detail: "Connection not found" }, { status: 404 });
      const current = state.items[index];
      const changed = body.config !== undefined || body.secrets !== undefined;
      state.items[index] = {
        ...current,
        name: typeof body.name === "string" ? body.name : current.name,
        config: (body.config as Record<string, unknown> | undefined) ?? current.config,
        secretHint: body.secrets ? hint(body.secrets) : current.secretHint,
        lastTest: changed ? null : current.lastTest,
        updatedAt: new Date().toISOString(),
      };
      return HttpResponse.json(state.items[index]);
    }),
    http.delete(apiUrl("/connections/:id"), async ({ request, params }) => {
      await record(request, `/connections/${String(params.id)}`);
      if (!state.items.some((item) => item.id === params.id)) {
        return HttpResponse.json({ detail: "Connection not found" }, { status: 404 });
      }
      state.items = state.items.filter((item) => item.id !== params.id);
      return new HttpResponse(null, { status: 204 });
    }),
    http.post(apiUrl("/connections/:id/test"), async ({ request, params }) => {
      await record(request, `/connections/${String(params.id)}/test`);
      const result = options.storedResult ?? passed;
      state.items = state.items.map((item) => (item.id === params.id ? { ...item, lastTest: result } : item));
      return HttpResponse.json(result);
    }),
  );
  return state;
}
