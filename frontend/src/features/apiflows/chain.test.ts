import { describe, expect, it } from "vitest";
import { flowChain } from "./chain";
import type { FlowStep } from "./types";

const step = (overrides: Partial<FlowStep>): FlowStep => ({
  title: "",
  method: "GET",
  path: "/",
  query: [],
  headers: [],
  body: null,
  saves: [],
  checks: [],
  ...overrides,
});

describe("flowChain", () => {
  it("links each saved value to the later steps that send it, and where", () => {
    const chain = flowChain([
      step({ path: "/auth", saves: [{ name: "token", path: "body.access_token" }, { name: "unused", path: "status" }] }),
      step({
        path: "/users/{{saved.token}}",
        query: [{ name: "q", value: "x {{ saved.token }}" }],
        headers: [{ name: "Authorization", value: "Bearer {{saved.token}}" }],
        body: { auth: { key: "{{saved.token}}" }, list: ["{{saved.token}}"] },
        saves: [{ name: "user_id", path: "body.id" }],
      }),
      step({ query: [{ name: "id", value: "{{saved.user_id}}" }] }),
    ]);
    expect(chain).toEqual([
      {
        name: "token",
        from: 0,
        path: "body.access_token",
        uses: [
          { step: 1, where: "path", name: "" },
          { step: 1, where: "query", name: "q" },
          { step: 1, where: "header", name: "Authorization" },
          { step: 1, where: "body", name: "auth.key" },
          { step: 1, where: "body", name: "list[0]" },
        ],
      },
      { name: "unused", from: 0, path: "status", uses: [] },
      { name: "user_id", from: 1, path: "body.id", uses: [{ step: 2, where: "query", name: "id" }] },
    ]);
  });
});
