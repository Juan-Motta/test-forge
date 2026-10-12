import { describe, expect, it } from "vitest";
import { INITIAL_LIVE_STATE, liveReducer, type LiveRunState } from "./live-state";

const send = (state: LiveRunState, message: Record<string, unknown>) =>
  liveReducer(state, { type: "message", message, now: 0 });

const started = send(INITIAL_LIVE_STATE, {
  type: "snapshot",
  run: { status: "running", endReason: null },
  transcript: [{ role: "agent", text: "Hello, how can I help?", turn: 0, tMs: 2000 }],
  turns: [{ turn: 0, latencyMs: null }],
});

describe("liveReducer: caller interruptions", () => {
  it("marks the interrupted agent reply when its transcript is already shown", () => {
    const state = send(started, {
      type: "callerInterrupted",
      tMs: 3500,
      agentTurn: 1,
      audioEndMs: 1500,
      heardText: "Hello, how",
    });

    expect(state.entries[0].interruption).toEqual({ heardText: "Hello, how", audioEndMs: 1500 });
    expect(state.interruptions).toEqual([{ agentTurn: 1, audioEndMs: 1500, heardText: "Hello, how", tMs: 3500 }]);
  });

  it("marks the agent reply whose transcript arrives after the interruption", () => {
    let state = send(started, { type: "callerInterrupted", tMs: 9000, agentTurn: 2, audioEndMs: 4000, heardText: "Our rooms" });
    expect(state.entries[0].interruption).toBeUndefined();

    state = send(state, { type: "agentTranscript", tMs: 9100, turn: 1, text: "Our rooms start at 120 dollars." });
    expect(state.entries[1].interruption).toEqual({ heardText: "Our rooms", audioEndMs: 4000 });

    state = send(state, { type: "agentTranscript", tMs: 12000, turn: 2, text: "Anything else?" });
    expect(state.entries[2].interruption).toBeUndefined();
  });

  it("accepts the runner's snake_case event", () => {
    const state = send(started, { type: "caller_interrupted", agent_turn: 1, audio_end_ms: null, heard_text: "" });
    expect(state.entries[0].interruption).toEqual({ heardText: "", audioEndMs: null });
  });

  it("keeps interruptions stored in a snapshot's transcript rows", () => {
    const state = send(INITIAL_LIVE_STATE, {
      type: "snapshot",
      run: { status: "running", endReason: null },
      transcript: [
        { role: "agent", text: "Hello there", turn: 0, tMs: 2000, interrupted: true, heardText: "Hello", audioEndMs: 600 },
      ],
      turns: [],
    });
    expect(state.entries[0].interruption).toEqual({ heardText: "Hello", audioEndMs: 600 });
  });
});
