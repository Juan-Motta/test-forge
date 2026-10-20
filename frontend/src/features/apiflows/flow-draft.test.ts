import { describe, expect, it } from "vitest";
import { checkValue, draftOf, moved, newStep, payloadOf } from "./flow-draft";
import { flowFixture } from "./testing";

describe("flow draft", () => {
  it("round-trips a stored flow to the same request body", () => {
    const flow = flowFixture({
      inputs: [{ name: "q", type: "text", description: "What to search", default: null, generate: "A product" }],
      agents: [{ id: "a-1", name: "Concierge" }],
    });
    flow.steps[1].checks = [
      { type: "path", path: "body.items.length", op: ">", value: 0 },
      { type: "path", path: "body.next", op: "exists", value: null },
      { type: "duration", maxMs: 1500 },
    ];
    const { payload, invalidBodies } = payloadOf(draftOf(flow));
    expect(invalidBodies).toEqual([]);
    expect(payload).toEqual({
      name: flow.name,
      description: flow.description,
      inputs: flow.inputs,
      steps: flow.steps,
      agentIds: ["a-1"],
    });
  });

  it("starts a new flow with one GET / step", () => {
    const draft = draftOf();
    expect(draft.steps).toHaveLength(1);
    expect(payloadOf(draft).payload.steps[0]).toMatchObject({ method: "GET", path: "/", body: null });
  });

  it("names the steps whose JSON body does not parse", () => {
    const draft = draftOf();
    draft.steps = [{ ...newStep(), body: "{ bad" }, { ...newStep(), body: '{"ok": true}' }];
    const { payload, invalidBodies } = payloadOf(draft);
    expect(invalidBodies).toEqual([0]);
    expect(payload.steps[1].body).toEqual({ ok: true });
  });

  it("types check values", () => {
    expect(checkValue("")).toBeNull();
    expect(checkValue("true")).toBe(true);
    expect(checkValue("12.5")).toBe(12.5);
    expect(checkValue("ok")).toBe("ok");
  });

  it("moves an item one place and keeps the ends", () => {
    expect(moved([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(moved([1, 2, 3], 2, -1)).toEqual([1, 3, 2]);
    expect(moved([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
  });
});
