import { http, HttpResponse } from "msw/http";
import { apiUrl, server } from "@/test/server";
import type { ApiKey, CreatedApiKey } from "./types";

/** A stored API key as the API lists it. */
export function apiKeyFixture(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: "k-ci",
    name: "CI pipeline",
    prefix: "ve_abcd1234",
    createdAt: "2026-10-01T10:00:00Z",
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

export type RecordedRequest = { method: string; path: string; body: unknown };

/** The secret the mock hands out for the n-th created key. */
export const createdSecret = (n: number) => `ve_new0000${n}_s3cr3tS3cr3tS3cr3tS3cr3tS3cr3tS3cr3t`;

/**
 * In-memory backend for `/api/api-keys`: keeps state across calls and records every write so
 * tests can assert the exact payloads the UI sent.
 */
export function mockApiKeysApi(initial: ApiKey[] = []) {
  const state = { items: [...initial], requests: [] as RecordedRequest[], listCalls: 0 };
  let created = 0;
  const record = async (request: Request, path: string) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    state.requests.push({ method: request.method, path, body });
    return body as Record<string, unknown> | undefined;
  };

  server.use(
    http.get(apiUrl("/api-keys"), () => {
      state.listCalls += 1;
      return HttpResponse.json(state.items);
    }),
    http.post(apiUrl("/api-keys"), async ({ request }) => {
      const body = (await record(request, "/api-keys")) ?? {};
      created += 1;
      const now = new Date();
      const days = typeof body.expiresInDays === "number" ? body.expiresInDays : null;
      const key: ApiKey = {
        id: `k-new-${created}`,
        name: String(body.name),
        prefix: `ve_new0000${created}`,
        createdAt: now.toISOString(),
        lastUsedAt: null,
        expiresAt: days === null ? null : new Date(now.getTime() + days * 86_400_000).toISOString(),
        revokedAt: null,
      };
      state.items = [key, ...state.items];
      const response: CreatedApiKey = { ...key, key: createdSecret(created) };
      return HttpResponse.json(response, { status: 201 });
    }),
    http.delete(apiUrl("/api-keys/:id"), async ({ request, params }) => {
      await record(request, `/api-keys/${String(params.id)}`);
      if (!state.items.some((item) => item.id === params.id)) {
        return HttpResponse.json({ detail: "API key not found" }, { status: 404 });
      }
      state.items = state.items.map((item) =>
        item.id === params.id ? { ...item, revokedAt: new Date().toISOString() } : item,
      );
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return state;
}
