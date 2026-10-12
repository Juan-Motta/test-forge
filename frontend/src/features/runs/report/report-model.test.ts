import { describe, expect, it } from "vitest";
import type { CriterionResult } from "@/features/judgements/types";
import type { TraceObservation } from "../types";
import { bandSpread, collectIssues, goalsMet, issuePins, timeAxis } from "./issues";
import { traceSummaryLine, waterfallRows } from "./waterfall";

function criterion(overrides: Partial<CriterionResult>): CriterionResult {
  return {
    criterionId: "c",
    text: "Criterion",
    kind: "should",
    source: "transcript",
    weight: 1,
    verdict: "pass",
    score: 90,
    rationale: "",
    evidence: [],
    ...overrides,
  };
}

const ev = (ref: string) => ({ source: "transcript" as const, ref, quote: "q" });

describe("collectIssues", () => {
  it("numbers the transcript turns cited by failed or partial criteria, in conversation order", () => {
    const issues = collectIssues(
      [
        criterion({ text: "States the total", verdict: "fail", evidence: [ev("A3"), ev("R1"), ev("T2")] }),
        criterion({ text: "Handles the change", verdict: "partial", evidence: [ev("A1"), ev("A3")] }),
        criterion({ text: "Greets", verdict: "pass", evidence: [ev("C1")] }),
        criterion({ text: "Unknown turn", verdict: "fail", evidence: [ev("A99")] }),
      ],
      ["A1", "C1", "A2", "A3"],
    );

    expect(issues).toEqual([
      { n: 1, ref: "A1", tone: "warn", criteria: ["Handles the change"] },
      { n: 2, ref: "A3", tone: "danger", criteria: ["States the total", "Handles the change"] },
    ]);
  });
});

describe("issuePins", () => {
  it("places each issue at the middle of its turn on the run timeline", () => {
    const pins = issuePins(
      [
        { n: 1, ref: "A1", tone: "warn", criteria: ["x"] },
        { n: 2, ref: "C9", tone: "danger", criteria: ["y"] },
      ],
      { durationMs: 10_000, turns: [{ role: "agent", startMs: 1000, endMs: 3000, ref: "A1" }] },
    );
    expect(pins).toEqual([{ n: 1, ref: "A1", tone: "warn", at: 0.2, label: "Issue 1 at 0:01: x" }]);
  });
});

describe("goalsMet", () => {
  it("counts passed criteria over the observable ones and names the first missed must", () => {
    expect(
      goalsMet([
        criterion({ verdict: "pass" }),
        criterion({ verdict: "fail", kind: "should", text: "Should one" }),
        criterion({ verdict: "fail", kind: "must", text: "Must one" }),
        criterion({ verdict: "not_observable", score: null }),
      ]),
    ).toEqual({ passed: 1, observable: 3, missed: "Must one" });
    expect(goalsMet([])).toEqual({ passed: 0, observable: 0, missed: null });
  });
});

describe("bandSpread", () => {
  it("is the range of the observed sample bands, null without two of them", () => {
    expect(bandSpread([2, null, 4, 3])).toBe(2);
    expect(bandSpread([3])).toBeNull();
    expect(bandSpread(undefined)).toBeNull();
    expect(bandSpread([null, 2])).toBeNull();
  });
});

describe("timeAxis", () => {
  it("splits the duration into evenly spaced clock ticks", () => {
    expect(timeAxis(252_000)).toEqual(["0:00", "1:03", "2:06", "3:09", "4:12"]);
  });
});

function observation(overrides: Partial<TraceObservation>): TraceObservation {
  return {
    id: "o",
    traceId: "t-1",
    parentId: null,
    type: "span",
    name: "realtime.session",
    startMs: 0,
    durationMs: 1000,
    model: null,
    tokens: null,
    costUsd: null,
    level: "DEFAULT",
    statusMessage: null,
    depth: 0,
    ...overrides,
  };
}

describe("waterfallRows", () => {
  it("positions bars over the run duration and flags warnings and errors", () => {
    const rows = waterfallRows(
      [
        observation({ id: "a", startMs: 0, durationMs: 10_000 }),
        observation({ id: "b", type: "llm", startMs: 2500, durationMs: 0, depth: 1, model: "gpt-x", tokens: 1200 }),
        observation({ id: "c", type: "tool", startMs: null, durationMs: null, level: "ERROR", statusMessage: "boom" }),
      ],
      5000,
    );
    expect(rows.map((row) => [row.id, row.left, row.width, row.flagged, row.note])).toEqual([
      ["a", 0, 100, false, ""],
      ["b", 25, 0.5, false, "gpt-x · 1.2k tokens"],
      ["c", 0, 0.5, true, "boom"],
    ]);
  });
});

describe("traceSummaryLine", () => {
  it("sums tokens and cost when the digest has none", () => {
    expect(
      traceSummaryLine({
        available: true,
        note: null,
        stats: null,
        observations: [observation({ tokens: 41_000, costUsd: 0.05 }), observation({ tokens: 200, costUsd: 0.034 })],
      }),
    ).toBe("Matched by threadId · 2 observations · 41.2k tokens · $0.084");
  });
});
