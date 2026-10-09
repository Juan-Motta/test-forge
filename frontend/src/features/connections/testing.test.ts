import { describe, expect, it } from "vitest";
import { apiUrl } from "@/test/server";
import { connectionFixture, mockConnectionsApi } from "./testing";
import type { Connection } from "./types";

async function create(name: string): Promise<Connection> {
  const response = await fetch(apiUrl("/connections"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, kind: "openai", config: {}, secrets: { apiKey: "sk-test" } }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Connection;
}

describe("mockConnectionsApi (test fake)", () => {
  it("never reuses an id after a delete", async () => {
    const api = mockConnectionsApi([connectionFixture()]);
    const a = await create("A");
    const b = await create("B");
    expect((await fetch(apiUrl(`/connections/${a.id}`), { method: "DELETE" })).status).toBe(204);
    const c = await create("C");

    expect(new Set([a.id, b.id, c.id, "c-openai"]).size).toBe(4);
    expect(api.items.map((item) => item.id)).toEqual(["c-openai", b.id, c.id]);
  });

  it("answers 404 when deleting an unknown id, like PATCH", async () => {
    const api = mockConnectionsApi([connectionFixture()]);
    const deleted = await fetch(apiUrl("/connections/missing"), { method: "DELETE" });
    const patched = await fetch(apiUrl("/connections/missing"), { method: "PATCH", body: "{}" });

    expect(deleted.status).toBe(404);
    expect(patched.status).toBe(404);
    expect(api.items).toHaveLength(1);
  });
});
