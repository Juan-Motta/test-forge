import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRunsApi, runFixture } from "@/features/runs/testing";
import { installFakeAudio, installFakeSockets } from "@/lib/live/testing";
import { renderWithClient } from "@/test/render";
import { LiveRunPanel } from "./LiveRunPanel";

const redirect = vi.hoisted(() => ({ toLogin: vi.fn() }));
vi.mock("@/lib/navigation/redirect", () => ({ redirectToLogin: redirect.toLogin }));

const running = runFixture({ status: "running", endReason: null, endedAt: null, startedAt: new Date().toISOString() });

let sockets: ReturnType<typeof installFakeSockets>;
let audio: ReturnType<typeof installFakeAudio>;

const snapshot = {
  type: "snapshot",
  run: { id: "r-1", batchId: "b-1", status: "running", endReason: null },
  transcript: [{ role: "agent", text: "Hello, how can I help?", turn: 0, tMs: 2000 }],
  turns: [{ turn: 0, latencyMs: null }],
};

async function renderPanel() {
  const api = mockRunsApi([running]);
  const view = renderWithClient(<LiveRunPanel runId="r-1" />);
  await screen.findByRole("heading", { name: "Booking with date change" });
  const socket = sockets.latest();
  act(() => socket.open());
  return { ...view, api, socket, user: userEvent.setup() };
}

function transcriptLines() {
  return within(screen.getByRole("list", { name: "Transcript" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);
}

describe("Live run", () => {
  beforeEach(() => {
    sockets = installFakeSockets();
    audio = installFakeAudio();
    redirect.toLogin.mockReset();
  });
  afterEach(() => {
    sockets.restore();
    audio.restore();
  });

  it("subscribes to the run and shows the snapshot, then the events in order", async () => {
    const { socket } = await renderPanel();
    expect(socket.url).toBe("ws://localhost:3000/api/runs/r-1/live");

    act(() => {
      socket.send(snapshot);
      socket.send({ type: "callerDecision", tMs: 4000, decisionId: 1, say: "I need a room", hangUp: false, reason: "opening: state the goal" });
      socket.send({ type: "callerSpeaking", tMs: 4200, decisionId: 1, say: "I need a room", reason: "opening: state the goal" });
      socket.send({ type: "turnEnded", tMs: 7000, turn: 1, latencyMs: 640, firstAudioMs: 5000, endMs: 6500, playbackEndMs: 7000, endReason: "silence" });
      socket.send({ type: "agentTranscript", tMs: 7100, turn: 1, text: "For which dates?" });
    });

    const lines = transcriptLines();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Hello, how can I help?");
    expect(lines[1]).toContain("I need a room");
    expect(lines[1]).toContain("Evaluator intent: opening: state the goal");
    expect(lines[2]).toContain("For which dates?");
    expect(lines[2]).toContain("640 ms");
    expect(screen.getByRole("list", { name: "Transcript" })).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Agent finished · waiting for its audio to play out")).toBeInTheDocument();
    const intent = screen.getByRole("region", { name: "Evaluator intent" });
    expect(intent).toHaveTextContent("opening: state the goal");
  });

  it("shows a decision as pending until the caller speaks, and drops a discarded one", async () => {
    const { socket } = await renderPanel();
    act(() => {
      socket.send(snapshot);
      socket.send({ type: "callerDecision", tMs: 4000, decisionId: 1, say: "Stale words", hangUp: false, reason: "too early" });
    });
    expect(transcriptLines()).toHaveLength(1);
    expect(screen.getByRole("status", { name: "Evaluator is about to say" })).toHaveTextContent("Stale words");

    act(() => {
      socket.send({ type: "agentBargeIn", tMs: 4500, callerTurn: 0 });
      socket.send({ type: "callerDecisionDiscarded", tMs: 5000, decisionId: 1 });
    });
    expect(screen.queryByRole("status", { name: "Evaluator is about to say" })).not.toBeInTheDocument();
    expect(transcriptLines()).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Evaluator intent" })).toHaveTextContent("Discarded");
    expect(screen.getByText(/Agent talked over the evaluator/)).toHaveTextContent("0:04");

    act(() => {
      socket.send({ type: "callerDecision", tMs: 6000, decisionId: 2, say: "Fresh words", hangUp: false, reason: "answer" });
      socket.send({ type: "callerSpeaking", tMs: 6300, decisionId: 2, say: "Fresh words", reason: "answer" });
    });
    expect(screen.queryByRole("status", { name: "Evaluator is about to say" })).not.toBeInTheDocument();
    const lines = transcriptLines();
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("Fresh words");
    expect(lines[1]).toContain("Evaluator intent: answer");
    expect(lines.join(" ")).not.toContain("Stale words");
  });

  it("marks the agent reply the caller interrupted and shows what was heard", async () => {
    const { socket } = await renderPanel();
    act(() => {
      socket.send(snapshot);
      socket.send({ type: "callerInterrupted", tMs: 3600, agentTurn: 1, audioEndMs: 1500, heardText: "Hello, how" });
    });

    const [agent] = within(screen.getByRole("list", { name: "Transcript" })).getAllByRole("listitem");
    expect(within(agent).getByText("Caller interrupted")).toBeInTheDocument();
    expect(within(agent).getByText("Hello, how")).toBeInTheDocument();
    expect(within(agent).getByTitle("Not heard — the caller interrupted at 1.5 s")).toHaveTextContent("can I help?");
    const list = screen.getByRole("list", { name: "Caller interruptions" });
    expect(list).toHaveTextContent("Caller interrupted agent reply #1 at 1.5 s · heard “Hello, how”");
  });

  it("replaces what it showed with the snapshot of a new connection", async () => {
    const { socket } = await renderPanel();
    act(() => {
      socket.send(snapshot);
      socket.send({ type: "agentTranscript", tMs: 7100, turn: 1, text: "For which dates?" });
      socket.send({ ...snapshot, transcript: [...snapshot.transcript, { role: "agent", text: "For which dates?", turn: 1, tMs: 7100 }] });
    });
    expect(transcriptLines()).toHaveLength(2);
  });

  it("shows how the call ended and links the report", async () => {
    const { socket } = await renderPanel();
    act(() => {
      socket.send(snapshot);
      socket.send({ type: "callerDecision", tMs: 9000, say: null, hangUp: true, reason: "goal met" });
      socket.send({ type: "finished", status: "completed", reason: "caller_hung_up" });
      socket.serverClose(1000);
    });
    expect(screen.getByText("Evaluator hung up")).toBeInTheDocument();
    expect(screen.getByText("Call ended")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open report" })).toHaveAttribute("href", "/runs/r-1");
    expect(screen.queryByRole("button", { name: "End call" })).not.toBeInTheDocument();
  });

  it("explains a run that no longer exists", async () => {
    const { socket } = await renderPanel();
    act(() => socket.serverClose(4404));
    expect(screen.getByRole("alert")).toHaveTextContent("This run no longer exists.");
  });

  it("goes to the login page when the session expired", async () => {
    const { socket } = await renderPanel();
    act(() => socket.serverClose(4401));
    expect(redirect.toLogin).toHaveBeenCalledTimes(1);
  });

  it("reconnects after the connection drops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { socket } = await renderPanel();
      act(() => socket.serverClose(1006));
      expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(sockets.sockets).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flags skipped audio when the server says the connection lags", async () => {
    const { socket } = await renderPanel();
    expect(screen.queryByText("Audio skipped")).not.toBeInTheDocument();
    act(() => socket.send({ type: "lagging", message: "audio dropped: the connection is slow" }));
    expect(screen.getByText("Audio skipped")).toBeInTheDocument();
  });

  it("plays audio only after the user starts listening, following the mix", async () => {
    const { socket, user } = await renderPanel();
    act(() => socket.audio(0, [16384]));
    expect(audio.contexts).toHaveLength(0);
    expect(screen.getByText("Agent speaking")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Listen" }));
    const context = audio.contexts[0];
    act(() => {
      socket.audio(0, [16384]);
      socket.audio(1, [-8192]);
    });
    await user.click(screen.getByRole("button", { name: "Agent only" }));
    expect(screen.getByRole("button", { name: "Agent only" })).toHaveAttribute("aria-pressed", "true");
    act(() => {
      socket.audio(0, [16384]);
      socket.audio(1, [-8192]);
    });
    expect(context.scheduled.map((item) => item.samples[0])).toEqual([0.5, -0.25, 0.5]);

    await user.click(screen.getByRole("button", { name: "Evaluator only" }));
    act(() => socket.audio(0, [16384]));
    expect(context.scheduled).toHaveLength(3);

    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0" } });
    expect(context.master.gain.value).toBe(0);
  });

  it("closes the stream and the audio when it unmounts", async () => {
    const { socket, user, unmount } = await renderPanel();
    await user.click(screen.getByRole("button", { name: "Listen" }));
    unmount();
    expect(socket.closedByClient).toBe(true);
    expect(audio.contexts[0].closed).toBe(true);
  });

  it("cancels the run", async () => {
    const { api, socket, user } = await renderPanel();
    act(() => socket.send(snapshot));
    await user.click(screen.getByRole("button", { name: "End call" }));
    await waitFor(() => expect(api.requests).toEqual([{ method: "POST", path: "/runs/r-1/cancel", body: undefined }]));
  });

  it("goes straight to the ended state for a run that finished before it connected", async () => {
    const { socket } = await renderPanel();
    act(() =>
      socket.send({ ...snapshot, run: { ...snapshot.run, status: "completed", endReason: "caller_hung_up" } }),
    );
    expect(screen.getByText("Call ended")).toBeInTheDocument();
    expect(screen.queryByText("Waiting for the agent")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open report" })).toBeInTheDocument();
  });

  it("explains when the browser refuses to start the audio, and stays not listening", async () => {
    audio.restore();
    audio = installFakeAudio({ resumeError: new Error("The user did not allow audio") });
    const { socket, user } = await renderPanel();
    act(() => socket.send(snapshot));

    await user.click(screen.getByRole("button", { name: "Listen" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not start the audio");
    expect(screen.getByRole("button", { name: "Listen" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop listening" })).not.toBeInTheDocument();
  });
});
