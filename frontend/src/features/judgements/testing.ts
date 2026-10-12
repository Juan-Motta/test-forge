import { http, HttpResponse } from "msw/http";
import { apiUrl, server } from "@/test/server";
import type { JudgeResult, Judgement, JudgementState } from "./types";

export function judgeResultFixture(overrides: Partial<JudgeResult> = {}): JudgeResult {
  return {
    summary: "The agent booked the room but never confirmed the dates back.",
    criteria: [
      {
        criterionId: "c-1",
        text: "Confirms the booking dates before closing",
        kind: "must",
        source: "transcript",
        weight: 3,
        verdict: "fail",
        score: 20,
        rationale: "The agent closed the call without repeating the dates.",
        evidence: [{ source: "transcript", ref: "A2", quote: "Sure, for which dates?" }],
      },
      {
        criterionId: "c-2",
        text: "Answers within two seconds",
        kind: "should",
        source: "timing",
        weight: 1,
        verdict: "pass",
        score: 90,
        rationale: "Median latency was 900 ms.",
        evidence: [{ source: "timing", ref: "T2", quote: "latency 420 ms" }],
      },
      {
        criterionId: "c-3",
        text: "Calls the availability tool",
        kind: "should",
        source: "trace",
        weight: 2,
        verdict: "not_observable",
        score: null,
        rationale: "No trace evidence.",
        evidence: [],
      },
    ],
    overallScore: 72,
    mustFailed: true,
    observableWeight: 4,
    suggestions: [
      {
        title: "Read the dates back before closing",
        detail: "Add a confirmation step to the closing instructions.",
        area: "prompt",
        priority: "high",
        evidenceRefs: ["A2", "R1"],
      },
    ],
    strengths: ["Friendly greeting"],
    brief: "# Judge brief\n\nFix the closing confirmation.",
    traceStats: { traceCount: 3, observationCount: 41, errorCount: 1, models: ["gpt-6-luna"] },
    traceNote: null,
    model: "gpt-6-judge",
    ...overrides,
  };
}

/** A judge v2 result: bands, failure tags, a capped criterion and gated not-observable reasons. */
export function judgeResultV2Fixture(overrides: Partial<JudgeResult> = {}): JudgeResult {
  const v1 = judgeResultFixture();
  return judgeResultFixture({
    version: 2,
    criteria: [
      {
        ...v1.criteria[0],
        verdict: "fail",
        score: 50,
        band: 2,
        failureTags: ["fabricated_information", "incomplete_task"],
        unobservableReason: null,
        capped: true,
      },
      { ...v1.criteria[1], verdict: "pass", score: 100, band: 5, failureTags: [], unobservableReason: null, capped: false },
      {
        ...v1.criteria[2],
        band: null,
        failureTags: [],
        unobservableReason: "traces_unavailable",
        capped: false,
      },
      {
        criterionId: "c-4",
        text: "Speaks naturally",
        kind: "should",
        source: "transcript",
        weight: 1,
        verdict: "partial",
        score: 70,
        band: 3,
        failureTags: ["incomplete_task", "some_new_tag"],
        unobservableReason: null,
        capped: false,
        rationale: "Some answers trail off.",
        evidence: [],
      },
    ],
    overallScore: 64,
    failureTags: { incomplete_task: 2, fabricated_information: 1, some_new_tag: 1 },
    ...overrides,
  });
}

export function judgementFixture(overrides: Partial<JudgementState> = {}): JudgementState {
  return {
    status: "completed",
    result: judgeResultFixture(),
    traceStats: null,
    traceNote: null,
    error: null,
    model: "gpt-6-judge",
    attempt: 1,
    createdAt: "2026-10-05T16:04:20Z",
    updatedAt: "2026-10-05T16:05:20Z",
    completedAt: "2026-10-05T16:05:20Z",
    ...overrides,
  };
}

type MockJudgementOptions = {
  /** Detail of the 409 the re-judge returns (e.g. "Judgement already in progress"). */
  rejudgeConflict?: string;
};

/**
 * In-memory `/api/runs/{id}/judgement`. Each run holds a list of states: every GET returns the
 * next one and the last one sticks (to script a judgement in progress). Records GETs and POSTs.
 */
export function mockJudgementApi(initial: Record<string, Judgement | Judgement[]>, options: MockJudgementOptions = {}) {
  const state = {
    sequences: Object.fromEntries(
      Object.entries(initial).map(([id, value]) => [id, Array.isArray(value) ? [...value] : [value]]),
    ) as Record<string, Judgement[]>,
    gets: {} as Record<string, number>,
    posts: [] as string[],
  };

  server.use(
    http.get(apiUrl("/runs/:id/judgement"), ({ params }) => {
      const id = String(params.id);
      state.gets[id] = (state.gets[id] ?? 0) + 1;
      const sequence = state.sequences[id] ?? [];
      const current = sequence.length > 1 ? sequence.shift() : sequence[0];
      return HttpResponse.json(current ?? { status: "none" });
    }),
    http.post(apiUrl("/runs/:id/judgement"), ({ params }) => {
      const id = String(params.id);
      state.posts.push(id);
      if (options.rejudgeConflict) {
        return HttpResponse.json({ detail: options.rejudgeConflict }, { status: 409 });
      }
      const pending = judgementFixture({ status: "pending", result: null, attempt: 2, completedAt: null });
      state.sequences[id] = [pending];
      return HttpResponse.json(pending, { status: 202 });
    }),
  );
  return state;
}
