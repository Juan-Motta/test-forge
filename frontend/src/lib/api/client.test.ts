import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiUrl, server } from "@/test/server";
import { apiFetch } from "./client";
import { ApiError } from "./errors";

const { redirectToLogin } = vi.hoisted(() => ({ redirectToLogin: vi.fn() }));
vi.mock("@/lib/navigation/redirect", () => ({ redirectToLogin }));

async function caught(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("apiFetch", () => {
  beforeEach(() => redirectToLogin.mockReset());

  it("sends JSON with credentials to the same-origin /api prefix and parses the response", async () => {
    // MSW rebuilds the Request in Node and drops `credentials`, so read it from the fetch call.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let seen: { body: unknown; contentType: string | null } | undefined;
    server.use(
      http.post(apiUrl("/things"), async ({ request }) => {
        seen = { body: await request.json(), contentType: request.headers.get("content-type") };
        return HttpResponse.json({ id: "t1" }, { status: 201 });
      }),
    );

    const result = await apiFetch<{ id: string }>("/things", { method: "POST", body: { a: 1 } });

    expect(result).toEqual({ id: "t1" });
    expect(seen).toEqual({ body: { a: 1 }, contentType: "application/json" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/things",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("returns undefined for 204 No Content", async () => {
    server.use(http.delete(apiUrl("/things/1"), () => new HttpResponse(null, { status: 204 })));

    await expect(apiFetch("/things/1", { method: "DELETE" })).resolves.toBeUndefined();
  });

  it("redirects to login on 401 from a protected call and still rejects", async () => {
    server.use(
      http.get(apiUrl("/auth/me"), () =>
        HttpResponse.json({ detail: "Not authenticated" }, { status: 401 }),
      ),
    );

    const error = await caught(apiFetch("/auth/me"));

    expect(error.status).toBe(401);
    expect(error.message).toBe("Not authenticated");
    expect(redirectToLogin).toHaveBeenCalledTimes(1);
  });

  it("does not redirect on 401 from the login call itself", async () => {
    server.use(
      http.post(apiUrl("/auth/login"), () =>
        HttpResponse.json({ detail: "Invalid email or password" }, { status: 401 }),
      ),
    );

    const error = await caught(apiFetch("/auth/login", { method: "POST", body: {} }));

    expect(error.status).toBe(401);
    expect(redirectToLogin).not.toHaveBeenCalled();
  });

  it("maps 422 detail entries to field errors keyed by their body location", async () => {
    server.use(
      http.post(apiUrl("/things"), () =>
        HttpResponse.json(
          {
            detail: [
              { type: "string_too_long", loc: ["body", "email"], msg: "String should have at most 320 characters" },
              { type: "missing", loc: ["body", "config", "baseUrl"], msg: "Field required" },
            ],
          },
          { status: 422 },
        ),
      ),
    );

    const error = await caught(apiFetch("/things", { method: "POST", body: {} }));

    expect(error.status).toBe(422);
    expect(error.fieldErrors).toEqual({
      email: "String should have at most 320 characters",
      "config.baseUrl": "Field required",
    });
    expect(error.message).toBe("Some fields need attention.");
  });

  it("reads Retry-After seconds from a 429", async () => {
    server.use(
      http.post(apiUrl("/auth/login"), () =>
        HttpResponse.json(
          { detail: "Too many login attempts, try again later" },
          { status: 429, headers: { "Retry-After": "120" } },
        ),
      ),
    );

    const error = await caught(apiFetch("/auth/login", { method: "POST", body: {} }));

    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(120);
  });

  it("reports a network failure as status 0 with a readable message", async () => {
    server.use(http.get(apiUrl("/things"), () => HttpResponse.error()));

    const error = await caught(apiFetch("/things"));

    expect(error.status).toBe(0);
    expect(error.message).toBe("Could not reach the server. Check your connection and try again.");
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    server.use(http.get(apiUrl("/things"), () => new HttpResponse("upstream down", { status: 502 })));

    const error = await caught(apiFetch("/things"));

    expect(error.status).toBe(502);
    expect(error.message).toBe("Something went wrong. Try again.");
  });
});
