import { describe, expect, it } from "vitest";
import { runFixture, snapshotFixture } from "@/features/runs/testing";
import { INITIAL_LIVE_STATE, type LiveRunState } from "./live-state";
import {
  batchEyebrow,
  batchSegments,
  evaluatorChip,
  evaluatorGoals,
  laneAxis,
  liveMetrics,
  sessionChip,
  sessionMeta,
} from "./live-view";

const state = (changes: Partial<LiveRunState>): LiveRunState => ({ ...INITIAL_LIVE_STATE, ...changes });
const entry = (role: "agent" | "caller", index: number) => ({ key: `k${index}`, role, text: "…", tMs: index * 1000 });

describe("live metrics", () => {
  it("averages the agent latencies, finds the slowest, and counts turns and interruptions", () => {
    const metrics = liveMetrics(
      state({
        entries: [entry("agent", 0), entry("caller", 1), entry("agent", 2), entry("caller", 3), entry("agent", 4)],
        turns: [
          { turn: 0, latencyMs: null },
          { turn: 1, latencyMs: 800 },
          { turn: 2, latencyMs: 2600 },
          { turn: 3, latencyMs: 1200 },
        ],
        interruptions: [
          { agentTurn: 1, audioEndMs: 1500, heardText: "Hello", tMs: 3600, confirmed: true },
          { agentTurn: 2, audioEndMs: 900, heardText: "For", tMs: 8600 },
        ],
      }),
    );
    expect(metrics).toEqual({ avgLatencyMs: 1533.3333333333333, slowestMs: 2600, p50Ms: 1200, turns: 5, interruptions: 2, confirmed: 1 });
  });

  it("has no latency before the agent answered anything", () => {
    expect(liveMetrics(INITIAL_LIVE_STATE)).toEqual({
      avgLatencyMs: null,
      slowestMs: null,
      p50Ms: null,
      turns: 0,
      interruptions: 0,
      confirmed: 0,
    });
  });
});

describe("evaluator goals", () => {
  it("lists the scenario goal, then its criteria", () => {
    const snapshot = snapshotFixture();
    const scenario = { ...snapshot.scenario, criteria: [{ text: "Confirms the new dates" }, { text: "" }, { text: "Gives a code" }] };
    expect(evaluatorGoals({ ...snapshot, scenario })).toEqual([
      "Book a double room for 3 nights.",
      "Confirms the new dates",
      "Gives a code",
    ]);
  });

  it("copes with an old snapshot without criteria", () => {
    expect(evaluatorGoals(snapshotFixture())).toEqual(["Book a double room for 3 nights."]);
    expect(evaluatorGoals(undefined)).toEqual([]);
  });
});

describe("evaluator chip", () => {
  it("names the evaluator mode and the realtime model", () => {
    expect(evaluatorChip(snapshotFixture({ evaluatorMode: "realtime", realtimeModel: "gpt-realtime-2.1" }))).toBe(
      "Realtime evaluator · gpt-realtime-2.1",
    );
    expect(evaluatorChip(snapshotFixture({ evaluatorMode: "pipeline", realtimeModel: "gpt-realtime-2.1" }))).toBe("Pipeline evaluator");
    expect(evaluatorChip(snapshotFixture())).toBeNull();
  });
});

describe("session cards", () => {
  it("chips a run by its state, with the score once judged", () => {
    expect(sessionChip(runFixture({ status: "running" }))).toEqual({ label: "Live", tone: "danger" });
    expect(sessionChip(runFixture({ status: "connecting" }))).toEqual({ label: "Connecting", tone: "agent" });
    expect(sessionChip(runFixture({ status: "queued" }))).toEqual({ label: "Queued", tone: "muted" });
    expect(sessionChip(runFixture({ status: "completed", score: 87.4 }))).toEqual({ label: "Done · 87", tone: "success" });
    expect(sessionChip(runFixture({ status: "completed", score: null }))).toEqual({ label: "Done", tone: "success" });
    expect(sessionChip(runFixture({ status: "failed" }))).toEqual({ label: "Failed", tone: "danger" });
    expect(sessionChip(runFixture({ status: "cancelled" }))).toEqual({ label: "Cancelled", tone: "muted" });
  });

  it("describes elapsed time, turns and median latency", () => {
    const started = "2026-10-05T16:00:00Z";
    const now = Date.parse(started) + 161_000;
    const live = runFixture({ status: "running", startedAt: started, endedAt: null });
    expect(sessionMeta(live, now, { turns: 7, p50Ms: 1100 })).toBe("2:41 · 7 turns · p50 1.1 s");
    expect(sessionMeta(live, now)).toBe("2:41");
    expect(sessionMeta(runFixture({ status: "running", startedAt: null }), now)).toBe("Starting…");
    expect(sessionMeta(runFixture({ status: "queued", startedAt: null }), now)).toBe("Starts when a slot frees up");
    const done = runFixture({ endReason: "tts_failed", status: "failed", agentTurns: 2, callerTurns: 2, latencyP50Ms: 640 });
    expect(sessionMeta(done, now)).toBe("4:12 · 4 turns · p50 640 ms · Speech synthesis failed");
    expect(sessionMeta(runFixture({ status: "running", startedAt: started, endedAt: null }), now, { turns: 1, p50Ms: null })).toBe(
      "2:41 · 1 turn",
    );
  });

  it("keeps the summary's turns and p50 where the live stats have nothing yet", () => {
    const now = Date.parse("2026-10-10T12:04:12Z");
    const done = runFixture({ endReason: "tts_failed", status: "failed", agentTurns: 2, callerTurns: 2, latencyP50Ms: 640 });
    expect(sessionMeta(done, now, { turns: 0, p50Ms: null })).toBe("4:12 · 4 turns · p50 640 ms · Speech synthesis failed");
    expect(sessionMeta(done, now, { turns: 5, p50Ms: null })).toBe("4:12 · 5 turns · p50 640 ms · Speech synthesis failed");
    expect(sessionMeta(done, now, { turns: 0, p50Ms: 900 })).toBe("4:12 · 4 turns · p50 900 ms · Speech synthesis failed");
  });
});

describe("batch progress", () => {
  it("counts completed, running, queued and failed runs", () => {
    const runs = [
      runFixture({ status: "completed" }),
      runFixture({ status: "completed" }),
      runFixture({ status: "running" }),
      runFixture({ status: "connecting" }),
      runFixture({ status: "queued" }),
      runFixture({ status: "failed" }),
      runFixture({ status: "interrupted" }),
    ];
    expect(batchSegments(runs).map(({ key, value }) => [key, value])).toEqual([
      ["completed", 2],
      ["running", 2],
      ["queued", 1],
      ["failed", 2],
    ]);
  });

  it("adds cancelled runs only when there are some", () => {
    const keys = batchSegments([runFixture({ status: "cancelled" })]).map((segment) => segment.key);
    expect(keys).toEqual(["completed", "running", "queued", "failed", "cancelled"]);
  });

  it("titles the batch with its short id, label and start time", () => {
    const createdAt = "2026-10-05T16:02:00Z";
    const time = new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    expect(batchEyebrow({ id: "b0412f00-1111", label: "Hotel booking regression", createdAt })).toBe(
      `Batch b0412f00 · Hotel booking regression · started ${time}`,
    );
    expect(batchEyebrow({ id: "b-9", label: null, createdAt })).toBe(`Batch b-9 · started ${time}`);
  });
});

describe("lane axis", () => {
  it("labels the window from its start to now", () => {
    expect(laneAxis(131_000 + 24_000, 24_000)).toEqual(["2:11", "2:19", "2:27", "now"]);
    expect(laneAxis(5000, 24_000)).toEqual(["0:00", "0:00", "0:00", "now"]);
  });
});
