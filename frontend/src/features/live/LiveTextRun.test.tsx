import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRunsApi, runFixture, textRunDetailFixture } from "@/features/runs/testing";
import { installFakeAudio, installFakeSockets } from "@/lib/live/testing";
import { renderWithClient } from "@/test/render";
import { INITIAL_LIVE_STATE, liveReducer, type LiveRunState } from "./live-state";
import { LiveRunPanel } from "./LiveRunPanel";

const redirect = vi.hoisted(() => ({ toLogin: vi.fn() }));
vi.mock("@/lib/navigation/redirect", () => ({ redirectToLogin: redirect.toLogin }));

const send = (state: LiveRunState, message: Record<string, unknown>) =>
  liveReducer(state, { type: "message", message, now: 0 });

const opened = send(INITIAL_LIVE_STATE, {
  type: "snapshot",
  run: { status: "running", endReason: null },
  transcript: [{ role: "caller", text: "A table for two", reason: "ask", tMs: 0 }],
  turns: [],
});

describe("liveReducer: text replies", () => {
  it("streams the reply into one agent bubble with its tools, then finalizes it", () => {
    let state = send(opened, { type: "agentToolStarted", tMs: 100, turn: 0, name: "check_availability" });
    state = send(state, { type: "agentTextDelta", tMs: 700, turn: 0, text: "Booked " });
    state = send(state, { type: "agentToolEnded", tMs: 750, turn: 0, name: "check_availability", success: false, elapsedMs: 300 });
    state = send(state, { type: "agentTextDelta", tMs: 800, turn: 0, text: "for 8 pm." });

    expect(state.entries).toHaveLength(2);
    expect(state.entries[1]).toMatchObject({
      role: "agent",
      text: "Booked for 8 pm.",
      streaming: true,
      tools: [{ name: "check_availability", success: false }],
      tMs: 700,
    });

    state = send(state, { type: "agentTranscript", tMs: 900, turn: 0, text: "Booked for 8 pm." });
    state = send(state, { type: "turnEnded", tMs: 900, turn: 0, requestMs: 0, firstTextMs: 700, endMs: 900, latencyMs: 700 });

    expect(state.entries).toHaveLength(2);
    expect(state.entries[1]).toMatchObject({
      text: "Booked for 8 pm.",
      latencyMs: 700,
      firstTextMs: 700,
      fullReplyMs: 900,
      tools: [{ name: "check_availability", success: false }],
    });
    expect(state.entries[1].streaming).toBeUndefined();
  });

  it("keeps a reply that never finished as broken off when the run ends", () => {
    let state = send(opened, { type: "agentTextDelta", tMs: 700, turn: 0, text: "Let me check the" });
    state = send(state, { type: "finished", status: "failed", reason: "agent_error" });

    expect(state.entries[1]).toMatchObject({ text: "Let me check the", incomplete: true });
    expect(state.entries[1].streaming).toBeUndefined();
  });
});

describe("Live text run", () => {
  let sockets: ReturnType<typeof installFakeSockets>;
  let audio: ReturnType<typeof installFakeAudio>;
  beforeEach(() => {
    sockets = installFakeSockets();
    audio = installFakeAudio();
  });
  afterEach(() => {
    sockets.restore();
    audio.restore();
  });

  it("shows the chat streaming in, without audio controls", async () => {
    const running = runFixture({ agentKind: "text", status: "running", endReason: null, endedAt: null, startedAt: new Date().toISOString() });
    const detail = textRunDetailFixture({ status: "running", endReason: null, endedAt: null, summary: null, transcript: null });
    mockRunsApi([running], { details: { "r-1": detail } });
    renderWithClient(<LiveRunPanel runId="r-1" />);
    await screen.findByRole("heading", { name: "Booking with date change" });
    const socket = sockets.latest();
    act(() => socket.open());

    act(() => {
      socket.send({ type: "snapshot", run: { status: "running", endReason: null }, transcript: [], turns: [] });
      socket.send({ type: "callerSpeaking", tMs: 0, decisionId: 1, say: "A table for two", reason: "ask" });
      socket.send({ type: "agentToolStarted", tMs: 100, turn: 0, name: "check_availability" });
      socket.send({ type: "agentTextDelta", tMs: 700, turn: 0, text: "Booked for" });
    });

    const transcript = screen.getByRole("list", { name: "Conversation transcript" });
    const rows = Array.from(transcript.children) as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("Booked for");
    expect(rows[1]).toHaveTextContent("Writing…");
    expect(within(rows[1]).getByText("check_availability")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Listen/ })).not.toBeInTheDocument();
    expect(screen.getByText("Agent replying")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End conversation" })).toBeInTheDocument();
  });
});
