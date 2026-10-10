import { describe, expect, it } from "vitest";
import { initialValues, parseTags, toChanges, weightTotal } from "./form-schema";
import { scenarioFixture } from "./testing";

describe("scenario form helpers", () => {
  it("parses comma-separated tags like the backend stores them", () => {
    expect(parseTags(" a, b ,, a,c ")).toEqual(["a", "b", "c"]);
  });

  it("totals only whole-number weights", () => {
    expect(weightTotal([{ weight: "60" }, { weight: " 30 " }, { weight: "x" }, { weight: "" }])).toBe(90);
  });

  it("finds no changes in an untouched scenario and whole objects in changed ones", () => {
    const scenario = scenarioFixture();
    const values = initialValues(scenario);
    expect(toChanges(scenario, values)).toEqual({});

    values.persona.notes = "New notes";
    values.tags = "booking";
    expect(toChanges(scenario, values)).toEqual({
      tags: ["booking"],
      persona: { ...scenario.persona, notes: "New notes" },
    });
  });
});
