import { describe, expect, it } from "vitest";
import {
  initialValues,
  isHiddenFor,
  parseTags,
  scenarioFormSchema,
  scenarioFormSchemaFor,
  toChanges,
  toNewScenario,
  weightTotal,
} from "./form-schema";
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

  it("defaults to the mini realtime model and sends a different one only when it changes", () => {
    expect(initialValues(undefined).realtimeModel).toBe("gpt-realtime-2.1-mini");
    expect(toNewScenario(initialValues(undefined)).realtimeModel).toBe("gpt-realtime-2.1-mini");
    const legacy = scenarioFixture();
    delete (legacy as Partial<typeof legacy>).realtimeModel;
    expect(initialValues(legacy).realtimeModel).toBe("gpt-realtime-2.1-mini");
    expect(initialValues(scenarioFixture({ realtimeModel: "gpt-realtime-2.1" })).realtimeModel).toBe("gpt-realtime-2.1");

    const scenario = scenarioFixture({ evaluatorMode: "realtime" });
    expect(toChanges(scenario, initialValues(scenario))).toEqual({});
    expect(toChanges(scenario, { ...initialValues(scenario), realtimeModel: "gpt-realtime-2.1" })).toEqual({
      realtimeModel: "gpt-realtime-2.1",
    });
    const result = scenarioFormSchema.safeParse({ ...initialValues(scenario), realtimeModel: "gpt-4o-realtime" });
    expect(result.success).toBe(false);
  });

  it("ignores the hidden voice-only values of a text agent's scenario", () => {
    const values = initialValues(scenarioFixture({ agentId: "a-chat", evaluatorConnectionId: "c-openai" }));
    values.voiceOverride = "not a voice!";
    values.evaluatorMode = "realtime";
    values.interruptions = [{ agentTurn: "x", afterS: "999" }];
    values.endConditions.maxSilenceS = "1";
    expect(scenarioFormSchema.safeParse(values).success).toBe(false);
    expect(scenarioFormSchemaFor("text").safeParse(values).success).toBe(true);
  });

  it("sends no voice-only settings for a text agent", () => {
    const scenario = scenarioFixture({ voiceOverride: "alloy", interruptions: [{ agentTurn: 2, afterMs: 2500 }] });
    const values = initialValues(scenario);
    values.voiceOverride = "nova";
    values.interruptions = [];
    values.endConditions.maxSilenceS = "1";
    const payload = toNewScenario(values, "text");
    for (const key of ["voiceOverride", "ttsConnectionId", "evaluatorMode", "realtimeModel", "interruptions"]) {
      expect(payload).not.toHaveProperty(key);
    }
    expect(payload.endConditions.maxSilenceS).toBe(15);
    expect(toChanges(scenario, values, "text")).toEqual({});
    expect(toNewScenario(values).voiceOverride).toBe("nova");
  });

  it("knows which server error paths a text agent's editor hides", () => {
    expect(isHiddenFor("text", "voiceOverride")).toBe(true);
    expect(isHiddenFor("text", "interruptions.0.afterMs")).toBe(true);
    expect(isHiddenFor("text", "endConditions.maxSilenceS")).toBe(true);
    expect(isHiddenFor("text", "endConditions.maxTurns")).toBe(false);
    expect(isHiddenFor("voice", "voiceOverride")).toBe(false);
  });
});
