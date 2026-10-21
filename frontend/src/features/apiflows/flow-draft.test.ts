import { describe, expect, it } from "vitest";
import { checkValue, draftOf, moved, newCheck, newStep, payloadOf, withBodyMode } from "./flow-draft";
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

  it("sends an absent check without a value", () => {
    const draft = draftOf();
    draft.steps[0].checks = [{ ...newCheck("path"), path: "body.errors", op: "absent", value: "left over" }];
    expect(payloadOf(draft).payload.steps[0].checks).toEqual([{ type: "path", path: "body.errors", op: "absent", value: null }]);
  });

  it("opens a GraphQL body in GraphQL mode and saves it back unchanged", () => {
    const flow = flowFixture();
    const body = { query: "query($id: ID!) { user(id: $id) { name } }", variables: { id: "{{input.q}}" } };
    flow.steps[0] = { ...flow.steps[0], method: "POST", body };
    const step = draftOf(flow).steps[0];
    expect(step).toMatchObject({ bodyMode: "graphql", gqlQuery: body.query });
    expect(JSON.parse(step.gqlVariables)).toEqual(body.variables);
    expect(payloadOf(draftOf(flow)).payload.steps[0].body).toEqual(body);
  });

  it("keeps any other body in JSON mode", () => {
    const flow = flowFixture();
    flow.steps[0] = { ...flow.steps[0], method: "POST", body: { query: "{ a }", page: 2 } };
    expect(draftOf(flow).steps[0].bodyMode).toBe("json");
  });

  it("sends a GraphQL query alone when it has no variables, and names unparsable variables", () => {
    const draft = draftOf();
    draft.steps = [
      { ...newStep(), method: "POST", bodyMode: "graphql", gqlQuery: "{ me { id } }", gqlVariables: "  " },
      { ...newStep(), method: "POST", bodyMode: "graphql", gqlQuery: "{ me { id } }", gqlVariables: "{ bad" },
    ];
    const { payload, invalidBodies } = payloadOf(draft);
    expect(payload.steps[0].body).toEqual({ query: "{ me { id } }" });
    expect(invalidBodies).toEqual([1]);
  });

  it("switches a step between JSON and GraphQL without losing what was typed", () => {
    const json = { ...newStep(), body: '{"query": "{ me { id } }", "variables": {"a": 1}}' };
    const graphql = withBodyMode(json, "graphql");
    // A GraphQL call is a POST.
    expect(graphql).toMatchObject({ bodyMode: "graphql", method: "POST", gqlQuery: "{ me { id } }" });
    expect(JSON.parse(graphql.gqlVariables)).toEqual({ a: 1 });
    expect(JSON.parse(withBodyMode(graphql, "json").body)).toEqual({ query: "{ me { id } }", variables: { a: 1 } });
    // Variables that do not parse yet come back as typed, for the JSON editor to show.
    const broken = withBodyMode({ ...graphql, gqlVariables: "{ a: 1" }, "json");
    expect(broken.body).toContain('"variables": { a: 1');
    // A body that is not a GraphQL request starts an empty query and stays as it was.
    const other = withBodyMode({ ...newStep(), method: "PUT", body: '{"name": "x"}' }, "graphql");
    expect(other).toMatchObject({ gqlQuery: "", gqlVariables: "", method: "PUT", body: '{"name": "x"}' });
    expect(withBodyMode(other, "json").body).toBe('{"name": "x"}');
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
