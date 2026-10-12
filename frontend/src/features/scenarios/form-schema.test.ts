import { describe, expect, it } from "vitest";
import { initialValues, parseTags, scenarioFormSchema, toChanges, weightTotal } from "./form-schema";
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

  it("keeps interruptions in seconds in the form and in milliseconds in the payload", () => {
    const scenario = scenarioFixture({ interruptions: [{ agentTurn: 2, afterMs: 2500 }] });
    const values = initialValues(scenario);
    expect(values.interruptions).toEqual([{ agentTurn: "2", afterS: "2.5" }]);
    expect(toChanges(scenario, values)).toEqual({});

    values.interruptions = [{ agentTurn: " 3 ", afterS: " 0.35 " }];
    expect(toChanges(scenario, values)).toEqual({ interruptions: [{ agentTurn: 3, afterMs: 350 }] });
    expect(initialValues(undefined).interruptions).toEqual([]);
  });

  it("validates interruptions: reply number, 0.3 to 60 seconds, unique replies, at most 10", () => {
    const base = initialValues(scenarioFixture());
    const problems = (interruptions: { agentTurn: string; afterS: string }[]) => {
      const result = scenarioFormSchema.safeParse({ ...base, interruptions });
      return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
    };

    expect(problems([{ agentTurn: "1", afterS: "0.3" }, { agentTurn: "2", afterS: "60" }])).toEqual([]);
    expect(problems([{ agentTurn: "0", afterS: "4" }])).toEqual([
      ["interruptions.0.agentTurn", "Use a whole number from 1 to 999."],
    ]);
    expect(problems([{ agentTurn: "1", afterS: "0.2" }])).toEqual([
      ["interruptions.0.afterS", "Use 0.3 to 60 seconds."],
    ]);
    expect(problems([{ agentTurn: "1", afterS: "abc" }])).toEqual([
      ["interruptions.0.afterS", "Use 0.3 to 60 seconds."],
    ]);
    expect(problems([{ agentTurn: "2", afterS: "1" }, { agentTurn: "2", afterS: "3" }])).toEqual([
      ["interruptions.1.agentTurn", "Each interruption needs a different agent reply."],
    ]);
    const eleven = Array.from({ length: 11 }, (_, index) => ({ agentTurn: String(index + 1), afterS: "1" }));
    expect(problems(eleven)).toEqual([["interruptions", "Use at most 10 interruptions."]]);
  });

  it("defaults to the pipeline evaluator and accepts only realtime voices in realtime mode", () => {
    expect(initialValues(undefined).evaluatorMode).toBe("pipeline");
    const legacy = scenarioFixture();
    delete (legacy as Partial<typeof legacy>).evaluatorMode;
    expect(initialValues(legacy).evaluatorMode).toBe("pipeline");

    const base = initialValues(scenarioFixture());
    const problems = (evaluatorMode: "pipeline" | "realtime", voiceOverride: string) => {
      const result = scenarioFormSchema.safeParse({ ...base, evaluatorMode, voiceOverride });
      return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    };
    expect(problems("pipeline", "nova")).toEqual([]);
    expect(problems("realtime", "")).toEqual([]);
    expect(problems("realtime", " marin ")).toEqual([]);
    expect(problems("realtime", "Marin")).toEqual(["voiceOverride"]);
    expect(problems("realtime", "nova")).toEqual(["voiceOverride"]);

    const scenario = scenarioFixture();
    expect(toChanges(scenario, { ...initialValues(scenario), evaluatorMode: "realtime" })).toEqual({
      evaluatorMode: "realtime",
    });
  });
});
