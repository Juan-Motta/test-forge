import { describe, expect, it } from "vitest";
import { flowErrorKey, flowErrors, isPlaced } from "./flow-errors";

describe("flowErrorKey", () => {
  it("maps a field of a step row to that row", () => {
    expect(flowErrorKey("steps.1.headers.0.value")).toBe("steps.1.headers.0");
    expect(flowErrorKey("steps.0.query.2.name")).toBe("steps.0.query.2");
    expect(flowErrorKey("steps.0.saves.1.name")).toBe("steps.0.saves.1");
    expect(flowErrorKey("steps.0.checks.2.duration.maxMs")).toBe("steps.0.checks.2");
  });

  it("maps step fields, body leaves and list-level errors to the step's field", () => {
    expect(flowErrorKey("steps.3.path")).toBe("steps.3.path");
    expect(flowErrorKey("steps.0.body.items.0.sku")).toBe("steps.0.body");
    expect(flowErrorKey("steps.0.checks")).toBe("steps.0.checks");
    expect(flowErrorKey("steps.2")).toBe("steps.2");
  });

  it("maps inputs to their row and other fields to themselves", () => {
    expect(flowErrorKey("inputs.1.name")).toBe("inputs.1");
    expect(flowErrorKey("name")).toBe("name");
    expect(flowErrorKey("agentIds.0")).toBe("agentIds");
    expect(flowErrorKey("steps")).toBe("steps");
  });
});

describe("flowErrors", () => {
  it("keeps the first message of each row, verbatim", () => {
    expect(
      flowErrors({
        "steps.1.headers.0.value": "no step saves 'token'",
        "steps.1.headers.0.name": "String should match pattern",
        "inputs.0.name": "input 'q' is defined twice",
      }),
    ).toEqual({ "steps.1.headers.0": "no step saves 'token'", "inputs.0": "input 'q' is defined twice" });
  });
});

describe("isPlaced", () => {
  it("places rows and step fields, and leaves the rest to the form alert", () => {
    for (const key of ["name", "inputs.0", "steps.1", "steps.1.body", "steps.1.headers.0", "steps.0.checks"]) {
      expect(isPlaced(key), key).toBe(true);
    }
    for (const key of ["steps", "inputs", "agentIds", "apiId", "_"]) expect(isPlaced(key), key).toBe(false);
  });
});
