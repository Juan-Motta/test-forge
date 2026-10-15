import { http, HttpResponse } from "msw/http";
import { apiUrl, server } from "@/test/server";
import type { Batch, BatchDetail, Run, RunDetail, RunLevels, RunSnapshot, RunStatus, RunTrace, TraceObservation } from "./types";
import { isActive } from "./format";

export function runFixture(overrides: Partial<Run> = {}): Run {
  return {
    id: "r-1",
    batchId: "b-1",
    position: 0,
    scenarioId: "s-booking",
    scenarioName: "Booking with date change",
    agentId: "a-hotel",
    agentName: "Hotel booking assistant",
    threadId: "1786f832-aaaa-bbbb-cccc-0000000003f",
    status: "completed",
    endReason: "caller_hung_up",
    error: null,
    createdAt: "2026-10-05T16:00:00Z",
    startedAt: "2026-10-05T16:00:01Z",
    endedAt: "2026-10-05T16:04:13Z",
    judgementStatus: null,
    score: null,
    mustFailed: null,
    persona: null,
    callerTurns: null,
    agentTurns: null,
    latencyP50Ms: null,
    ...overrides,
  };
}

export function snapshotFixture(overrides: Partial<RunSnapshot["scenario"]> = {}): RunSnapshot {
  return {
    scenario: {
      id: "s-booking",
      name: "Booking with date change",
      persona: { name: "Lucía", locale: "es-MX", temperament: "hurried", notes: "" },
      goal: "Book a double room for 3 nights.",
      endConditions: { maxDurationS: 360, maxSilenceS: 15, hangUpWhen: "goal_or_goodbye" },
      ...overrides,
    },
    agent: { id: "a-hotel", name: "Hotel booking assistant", protocol: "live" },
    connections: {
      tts: { id: "c-openai", name: "OpenAI" },
      evaluator: { id: "c-openai", name: "OpenAI", chatModel: "gpt-6-luna" },
    },
  };
}

export function runDetailFixture(overrides: Partial<RunDetail> = {}): RunDetail {
  return {
    ...runFixture(),
    summary: {
      status: "completed",
      reason: "caller_hung_up",
      durationMs: 252_000,
      callerTurns: 2,
      agentTurns: 3,
      latenciesMs: [420, 1800, 900],
      warnings: [],
    },
    transcript: [
      { role: "agent", text: "Hello, how can I help?", startMs: 1200, endMs: 2600, latencyMs: null },
      { role: "caller", text: "I need a room for three nights.", startMs: 3100, endMs: 5000, reason: "opening: state the goal" },
      { role: "agent", text: "Sure, for which dates?", startMs: 5420, endMs: 7000, latencyMs: 420 },
    ],
    snapshot: snapshotFixture(),
    ...overrides,
  };
}

/**
 * A finished text run (stream mode): three user messages, two replies (the first used a tool) and
 * a third reply that broke off when the agent failed.
 */
export function textRunDetailFixture(overrides: Partial<RunDetail> = {}): RunDetail {
  const snapshot = snapshotFixture({
    endConditions: { maxDurationS: 360, maxSilenceS: 15, maxTurns: 3, hangUpWhen: "goal_or_goodbye" },
  });
  return {
    ...runFixture({ agentKind: "text", agentName: "Chat desk", agentId: "a-chat", status: "failed", endReason: "agent_error" }),
    error: "The agent's reply ended without a final event",
    summary: {
      kind: "text",
      protocol: "http_chat",
      textMode: "stream",
      status: "failed",
      reason: "agent_error",
      durationMs: 42_000,
      callerTurns: 3,
      agentTurns: 2,
      maxTurns: 3,
      latenciesMs: [800, 1600],
      turns: [
        { index: 0, kind: "reply", requestMs: 0, firstTextMs: 800, endMs: 1500, latencyMs: 800, tools: ["check_availability"] },
        { index: 1, kind: "reply", requestMs: 4000, firstTextMs: 5600, endMs: 7500, latencyMs: 1600, tools: [] },
      ],
      warnings: [],
    },
    transcript: [
      { role: "caller", text: "A table for two at 8, please.", startMs: 0, endMs: 0, reason: "ask" },
      {
        role: "agent",
        text: "Booked for 8 pm.",
        startMs: 800,
        endMs: 1500,
        latencyMs: 800,
        firstTextMs: 800,
        tools: ["check_availability"],
      },
      { role: "caller", text: "Can you make it 9?", startMs: 4000, endMs: 4000, reason: "change" },
      { role: "agent", text: "Done, 9 pm.", startMs: 5600, endMs: 7500, latencyMs: 1600, firstTextMs: 1600, tools: [] },
      { role: "caller", text: "Is there parking?", startMs: 9000, endMs: 9000, reason: "parking" },
      { role: "agent", text: "Let me check the", startMs: 9000, endMs: 9500, latencyMs: null, firstTextMs: null, tools: [], incomplete: true },
    ],
    snapshot: {
      ...snapshot,
      scenario: { ...snapshot.scenario, evaluatorMode: "pipeline" },
      agent: { id: "a-chat", name: "Chat desk", protocol: "http_chat", kind: "text", textMode: "stream" },
      connections: { tts: null, evaluator: { id: "c-openai", name: "OpenAI", chatModel: "gpt-6-luna" } },
    },
    ...overrides,
  };
}

/** Levels of `runDetailFixture()`'s 4:12 run: 8 bins per side and its three turns. */
export function levelsFixture(overrides: Partial<RunLevels> = {}): RunLevels {
  return {
    durationMs: 252_000,
    agent: [0.2, 0.9, 0, 0, 0, 0.6, 0.4, 0],
    caller: [0, 0, 0.5, 1, 0, 0, 0, 0.3],
    turns: [
      { role: "agent", startMs: 1200, endMs: 2600, ref: "A1" },
      { role: "caller", startMs: 3100, endMs: 5000, ref: "C1" },
      { role: "agent", startMs: 5420, endMs: 7000, ref: "A2" },
    ],
    ...overrides,
  };
}

export function traceObservationFixture(overrides: Partial<TraceObservation> = {}): TraceObservation {
  return {
    id: "o-1",
    traceId: "t-1",
    parentId: null,
    type: "span",
    name: "realtime.session",
    startMs: 0,
    durationMs: 252_000,
    model: null,
    tokens: null,
    costUsd: null,
    level: "DEFAULT",
    statusMessage: null,
    depth: 0,
    ...overrides,
  };
}

/** A trace with a root span, a generation, and a tool call that failed. */
export function traceFixture(overrides: Partial<RunTrace> = {}): RunTrace {
  return {
    available: true,
    note: null,
    stats: { observationCount: 3, totalTokens: 1200 },
    observations: [
      traceObservationFixture(),
      traceObservationFixture({
        id: "o-2",
        parentId: "o-1",
        type: "llm",
        name: "turn-02 · generation",
        startMs: 5000,
        durationMs: 900,
        model: "gpt-6-luna",
        tokens: 1200,
        costUsd: 0.012,
        depth: 1,
      }),
      traceObservationFixture({
        id: "o-3",
        parentId: "o-2",
        type: "tool",
        name: "check_availability",
        startMs: 5200,
        durationMs: 400,
        level: "ERROR",
        statusMessage: "rate lookup failed",
        depth: 2,
      }),
    ],
    ...overrides,
  };
}

export function batchFixture(overrides: Partial<Batch> = {}): Batch {
  return {
    id: "b-1",
    label: null,
    concurrency: 1,
    status: "completed",
    total: 1,
    counts: { completed: 1 },
    createdBy: "u-1",
    createdAt: "2026-10-05T16:00:00Z",
    ...overrides,
  };
}

export type RecordedRequest = { method: string; path: string; body: unknown };

type MockOptions = {
  /** Scenario id -> the backend's reason it cannot run (422 on launch). */
  notRunnable?: Record<string, string>;
  /** Names for scenarios launched through the fake (id -> name). */
  scenarioNames?: Record<string, string>;
  /** Detail fields per run id (summary, transcript, snapshot). */
  details?: Record<string, Partial<RunDetail>>;
  batches?: Batch[];
  /** Levels per run id, or the status code to answer with (409 while running). Default: `levelsFixture()`. */
  levels?: Record<string, RunLevels | number>;
  /** Trace per run id. Default: unavailable, with a note. */
  traces?: Record<string, RunTrace>;
  /** The status and detail `POST /runs/{id}/rerun` fails with (409 deleted scenario, 422 not runnable). */
  rerunError?: { status: number; detail: unknown };
};

const NO_TRACE: RunTrace = { available: false, note: "The agent has no Langfuse connection.", stats: null, observations: [] };

const notFound = (what: string) => HttpResponse.json({ detail: `${what} not found` }, { status: 404 });

function countsOf(runs: Run[]): Partial<Record<RunStatus, number>> {
  const counts: Partial<Record<RunStatus, number>> = {};
  for (const run of runs) counts[run.status] = (counts[run.status] ?? 0) + 1;
  return counts;
}

/**
 * In-memory backend for `/api/runs`: filters and pagination (newest first), launch with the
 * not-runnable 422, cancel with the 409, batches; records every non-GET request.
 */
export function mockRunsApi(initial: Run[] = [], options: MockOptions = {}) {
  const state = {
    runs: [...initial],
    batches: [...(options.batches ?? [])],
    requests: [] as RecordedRequest[],
    listQueries: [] as string[],
  };
  let created = 0;
  const record = async (request: Request, path: string) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as unknown) : undefined;
    state.requests.push({ method: request.method, path, body });
    return (body ?? {}) as Record<string, unknown>;
  };
  const batchDetail = (batch: Batch): BatchDetail => {
    const runs = state.runs.filter((run) => run.batchId === batch.id).sort((a, b) => a.position - b.position);
    return { ...batch, counts: runs.length ? countsOf(runs) : batch.counts, runs };
  };

  server.use(
    // Never judged, unless a test mocks the judgements API on top (`mockJudgementApi`).
    http.get(apiUrl("/runs/:id/judgement"), () => HttpResponse.json({ status: "none" })),
    http.get(apiUrl("/runs/batches"), () => {
      const items = [...state.batches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return HttpResponse.json({ items: items.map((b) => ({ ...b, ...countsFor(b) })), total: items.length });
    }),
    http.get(apiUrl("/runs/batches/:id"), ({ params }) => {
      const batch = state.batches.find((item) => item.id === params.id);
      return batch ? HttpResponse.json(batchDetail(batch)) : notFound("Batch");
    }),
    http.get(apiUrl("/runs"), ({ request }) => {
      const params = new URL(request.url).searchParams;
      state.listQueries.push(params.toString());
      const status = params.get("status");
      const scenarioId = params.get("scenarioId");
      const batchId = params.get("batchId");
      const limit = Number(params.get("limit") ?? 50);
      const offset = Number(params.get("offset") ?? 0);
      const matching = state.runs
        .filter(
          (run) =>
            (!status || run.status === status) &&
            (!scenarioId || run.scenarioId === scenarioId) &&
            (!batchId || run.batchId === batchId),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.position - a.position);
      if (params.get("order") === "oldest") matching.reverse();
      return HttpResponse.json({ items: matching.slice(offset, offset + limit), total: matching.length });
    }),
    http.get(apiUrl("/runs/:id"), ({ params }) => {
      const run = state.runs.find((item) => item.id === params.id);
      if (!run) return notFound("Run");
      const extra = options.details?.[run.id] ?? {};
      const detail: RunDetail = {
        ...run,
        summary: null,
        transcript: null,
        snapshot: snapshotFixture({ id: run.scenarioId ?? "", name: run.scenarioName }),
        ...extra,
      };
      return HttpResponse.json(detail);
    }),
    http.post(apiUrl("/runs"), async ({ request }) => {
      const body = await record(request, "/runs");
      const ids = (body.scenarioIds as string[] | undefined) ?? [];
      const refused = ids
        .map((id, index) => ({ id, index, msg: options.notRunnable?.[id] }))
        .filter((item) => item.msg !== undefined);
      if (refused.length > 0) {
        const detail = refused.map(({ id, index, msg }) => ({
          type: "value_error",
          loc: ["body", "scenarioIds", index],
          msg,
          scenarioId: id,
        }));
        return HttpResponse.json({ detail }, { status: 422 });
      }
      created += 1;
      const batchId = `b-new-${created}`;
      const repetitions = Number(body.repetitions ?? 1);
      const now = new Date().toISOString();
      const runs: Run[] = [];
      for (let rep = 0; rep < repetitions; rep += 1) {
        for (const id of ids) {
          runs.push(
            runFixture({
              id: `${batchId}-r${runs.length + 1}`,
              batchId,
              position: runs.length,
              scenarioId: id,
              scenarioName: options.scenarioNames?.[id] ?? id,
              status: "queued",
              endReason: null,
              createdAt: now,
              startedAt: null,
              endedAt: null,
            }),
          );
        }
      }
      const batch = batchFixture({
        id: batchId,
        label: (body.label as string | undefined) ?? null,
        concurrency: Number(body.concurrency ?? 1),
        status: "queued",
        total: runs.length,
        counts: { queued: runs.length },
        createdAt: now,
      });
      state.runs.push(...runs);
      state.batches.push(batch);
      return HttpResponse.json(batchDetail(batch), { status: 201 });
    }),
    http.get(apiUrl("/runs/:id/levels"), ({ params }) => {
      const run = state.runs.find((item) => item.id === params.id);
      if (!run) return notFound("Run");
      if (isActive(run.status)) return HttpResponse.json({ detail: "Run still in progress" }, { status: 409 });
      const levels = options.levels?.[run.id] ?? levelsFixture();
      return typeof levels === "number"
        ? HttpResponse.json({ detail: "Levels unavailable" }, { status: levels })
        : HttpResponse.json(levels);
    }),
    http.get(apiUrl("/runs/:id/trace"), ({ params }) => {
      const run = state.runs.find((item) => item.id === params.id);
      return run ? HttpResponse.json(options.traces?.[run.id] ?? NO_TRACE) : notFound("Run");
    }),
    http.post(apiUrl("/runs/:id/rerun"), async ({ request, params }) => {
      const id = String(params.id);
      await record(request, `/runs/${id}/rerun`);
      const run = state.runs.find((item) => item.id === id);
      if (!run) return notFound("Run");
      if (options.rerunError) {
        return HttpResponse.json({ detail: options.rerunError.detail }, { status: options.rerunError.status });
      }
      created += 1;
      const batchId = `b-new-${created}`;
      const now = new Date().toISOString();
      const rerun = runFixture({
        ...run,
        id: `${batchId}-r1`,
        batchId,
        position: 0,
        status: "queued",
        endReason: null,
        createdAt: now,
        startedAt: null,
        endedAt: null,
      });
      const batch = batchFixture({ id: batchId, label: `Re-run of ${id.slice(0, 8)}`, status: "queued", createdAt: now });
      state.runs.push(rerun);
      state.batches.push(batch);
      return HttpResponse.json(batchDetail(batch), { status: 201 });
    }),
    http.post(apiUrl("/runs/batches/:id/cancel"), async ({ request, params }) => {
      const id = String(params.id);
      await record(request, `/runs/batches/${id}/cancel`);
      const index = state.batches.findIndex((item) => item.id === id);
      if (index < 0) return notFound("Batch");
      const runs = state.runs.filter((run) => run.batchId === id && isActive(run.status));
      if (runs.length === 0) return HttpResponse.json({ detail: "Batch already finished" }, { status: 409 });
      state.runs = state.runs.map((run) =>
        runs.includes(run) ? { ...run, status: "cancelled", endReason: "cancelled" } : run,
      );
      state.batches[index] = { ...state.batches[index], status: "cancelled" };
      return HttpResponse.json(batchDetail(state.batches[index]), { status: 202 });
    }),
    http.post(apiUrl("/runs/:id/cancel"), async ({ request, params }) => {
      const id = String(params.id);
      await record(request, `/runs/${id}/cancel`);
      const index = state.runs.findIndex((item) => item.id === id);
      if (index < 0) return notFound("Run");
      if (!isActive(state.runs[index].status)) {
        return HttpResponse.json({ detail: "Run already finished" }, { status: 409 });
      }
      state.runs[index] = {
        ...state.runs[index],
        status: "cancelled",
        endReason: "cancelled",
        endedAt: new Date().toISOString(),
      };
      return HttpResponse.json(state.runs[index], { status: 202 });
    }),
  );

  function countsFor(batch: Batch) {
    const runs = state.runs.filter((run) => run.batchId === batch.id);
    return runs.length ? { counts: countsOf(runs) } : {};
  }

  return state;
}
