import { describe, expect, it } from "vitest";
import { LOCALES, createTranslator } from "@/lib/i18n";
import { MESSAGES } from "@/lib/i18n/messages";
import { INITIAL_LIVE_STATE, TURN_STATES, liveReducer, turnStateLabel, type LiveRunState } from "./live-state";

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

describe("liveReducer: interruption confirmations", () => {
  const cut = send(started, {
    type: "callerInterrupted",
    tMs: 3500,
    agentTurn: 1,
    audioEndMs: 1500,
    heardText: "Hello, how",
    itemId: "item-1",
  });

  it("leaves an interruption unconfirmed until the agent confirms it", () => {
    expect(cut.interruptions[0].confirmed).toBeUndefined();
    expect(cut.entries[0].interruption?.confirmed).toBeUndefined();
  });

  it("marks the interruption and its agent reply confirmed", () => {
    const state = send(cut, {
      type: "interruptionConfirmed",
      tMs: 3700,
      agentTurn: 1,
      itemId: "item-1",
      kind: "truncated",
      audioEndMs: 1500,
    });
    expect(state.interruptions[0]).toMatchObject({ confirmed: true, kind: "truncated" });
    expect(state.entries[0].interruption).toMatchObject({ heardText: "Hello, how", confirmed: true });
  });

  it("keeps the confirmation for a reply whose transcript arrives later", () => {
    let state = send(started, { type: "callerInterrupted", tMs: 9000, agentTurn: 2, audioEndMs: 4000, heardText: "Our rooms" });
    state = send(state, { type: "interruptionConfirmed", tMs: 9100, agentTurn: 2, itemId: "item-2", kind: "deleted", audioEndMs: 0 });
    state = send(state, { type: "agentTranscript", tMs: 9200, turn: 1, text: "Our rooms start at 120." });
    expect(state.entries[1].interruption).toMatchObject({ confirmed: true });
  });

  it("reads the confirmation stored in a snapshot's transcript rows", () => {
    const state = send(INITIAL_LIVE_STATE, {
      type: "snapshot",
      run: { status: "running" },
      transcript: [
        {
          role: "agent",
          text: "Hello there",
          turn: 0,
          tMs: 2000,
          interrupted: true,
          heardText: "Hello",
          audioEndMs: 600,
          interruptionConfirmed: true,
        },
      ],
    });
    expect(state.entries[0].interruption).toMatchObject({ confirmed: true });
  });
});

describe("liveReducer: the realtime evaluator's decision after its line", () => {
  const speaking = send(started, { type: "callerSpeaking", tMs: 3000, decisionId: 1, say: "", reason: "realtime" });

  it("moves to hanging up when a spoken line without a transcript hangs up", () => {
    const state = send(speaking, { type: "callerDecision", tMs: 4000, decisionId: 1, say: null, hangUp: true, reason: "realtime" });
    expect(state.turnState).toBe("hanging_up");
    expect(state.entries[1].text).toBe("");
  });

  it("keeps the line's turn state when it ends without hanging up", () => {
    const state = send(speaking, { type: "callerDecision", tMs: 4000, decisionId: 1, say: null, hangUp: false, reason: "realtime" });
    expect(state.turnState).toBe("evaluator");
    expect(state.pending).toBeNull();
  });
});

describe("turn state labels", () => {
  it("has a catalog entry for every turn state, voice and text, in every language", () => {
    for (const state of TURN_STATES) {
      expect(MESSAGES.en).toHaveProperty([`live.turn.${state}`]);
      expect(MESSAGES.en).toHaveProperty([`live.textTurn.${state}`]);
    }
    for (const locale of LOCALES) {
      const t = createTranslator(locale);
      for (const state of TURN_STATES) {
        expect(turnStateLabel(t, state, "voice")).toEqual(expect.any(String));
        expect(turnStateLabel(t, state, "text")).toEqual(expect.any(String));
      }
    }
  });
});
