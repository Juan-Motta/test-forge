import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { RunDetailContainer } from "./RunDetailContainer";
import { mockRunsApi, runDetailFixture, runFixture, snapshotFixture } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
}));

const run = runFixture();
const detail = runDetailFixture();

describe("Run detail", () => {
  beforeEach(() => nav.push.mockReset());

  it("shows the header, metrics, recording and transcript with the evaluator's intent", async () => {
    mockRunsApi([run], { details: { "r-1": detail } });
    renderWithClient(<RunDetailContainer runId="r-1" />);

    expect(await screen.findByRole("heading", { level: 1, name: "r-1 Booking with date change" })).toBeInTheDocument();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Runs" })).toHaveAttribute("href", "/runs");
    expect(within(breadcrumb).getByRole("link", { name: "Batch b-1" })).toHaveAttribute("href", "/runs?batchId=b-1");
    const chips = screen.getByRole("list", { name: "Run details" });
    // The chips and the header actions share one row (centred together, not on the title's baseline).
    expect(chips.parentElement).toContainElement(await screen.findByRole("button", { name: "Re-run" }));
    expect(within(chips).getByText("Hotel booking assistant")).toBeInTheDocument();
    expect(within(chips).getByText("Duration")).toBeInTheDocument();
    expect(chips).toHaveTextContent("Duration 4:12");
    expect(chips).toHaveTextContent("thread 1786f832-aaaa-bbbb-cccc-0000000003f");
    expect(screen.getByText("Lucía · hurried · es-MX")).toBeInTheDocument();
    expect(screen.queryByText(/evaluator$/)).not.toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Evaluator hung up")).toBeInTheDocument();

    const metrics = screen.getByRole("list", { name: "Run metrics" });
    const metric = (name: string) => within(metrics).getByRole("listitem", { name });
    expect(within(metric("Duration")).getByText("4:12")).toBeInTheDocument();
    expect(within(metric("Latency p50")).getByText("900 ms")).toBeInTheDocument();
    expect(within(metric("Slowest reply")).getByText("1.8 s")).toBeInTheDocument();
    expect(within(metric("Agent turns")).getByText("3")).toBeInTheDocument();
    expect(within(metric("Evaluator turns")).getByText("2")).toBeInTheDocument();

    expect(screen.getByLabelText("Agent track")).toHaveAttribute("src", "/api/runs/r-1/audio/agent");
    expect(screen.getByLabelText("Evaluator track")).toHaveAttribute("src", "/api/runs/r-1/audio/caller");

    const transcript = screen.getByRole("list", { name: "Transcript" });
    const turns = within(transcript).getAllByRole("listitem");
    expect(turns).toHaveLength(3);
    expect(turns[0]).toHaveTextContent("0:01");
    expect(turns[0]).toHaveTextContent("Agent");
    expect(turns[1]).toHaveTextContent("Evaluator");
    expect(turns[1]).toHaveTextContent("I need a room for three nights.");
    expect(turns[1]).toHaveTextContent("Evaluator intent: opening: state the goal");
    expect(turns[2]).toHaveTextContent("420 ms");

    expect(turns[0]).toHaveAttribute("id", "turn-A1");
    expect(turns[1]).toHaveAttribute("id", "turn-C1");
    expect(turns[2]).toHaveAttribute("id", "turn-A2");

    const judgement = screen.getByRole("region", { name: "Judgement" });
    expect(await within(judgement).findByText(/^Not judged yet\./)).toBeInTheDocument();
  });

  it("shows what the caller heard of an interrupted agent reply and strikes the rest", async () => {
    const interrupted = runDetailFixture({
      transcript: [
        {
          role: "agent",
          text: "Our rooms start at 120 dollars and include breakfast and parking.",
          startMs: 1200,
          endMs: 6000,
          latencyMs: null,
          interrupted: true,
          heardText: "Our rooms start at 120 dollars",
          audioEndMs: 4000,
        },
        { role: "caller", text: "Wait, is breakfast included?", startMs: 5300, endMs: 7000, reason: "barge in" },
        {
          role: "agent",
          text: "Yes, it is.",
          startMs: 7500,
          endMs: 8200,
          latencyMs: 500,
          interrupted: true,
          heardText: "",
          audioEndMs: null,
        },
      ],
    });
    mockRunsApi([run], { details: { "r-1": interrupted } });
    renderWithClient(<RunDetailContainer runId="r-1" />);

    const transcript = await screen.findByRole("list", { name: "Transcript" });
    const [first, caller, last] = within(transcript).getAllByRole("listitem");
    expect(within(first).getByText("Interrupted")).toBeInTheDocument();
    expect(within(first).getByText("Our rooms start at 120 dollars")).toBeInTheDocument();
    const unheard = within(first).getByTitle("Not heard — the caller interrupted at 4.0 s");
    expect(unheard).toHaveTextContent("and include breakfast and parking.");
    expect(unheard).toHaveTextContent("Not heard — the caller interrupted at 4.0 s");
    expect(within(caller).queryByText("Interrupted")).not.toBeInTheDocument();
    expect(within(last).getByTitle("Not heard — the caller interrupted before any audio played")).toHaveTextContent(
      "Yes, it is.",
    );
  });

  it("lists the heard part separately when it is not the start of the reply", async () => {
    const interrupted = runDetailFixture({
      transcript: [
        {
          role: "agent",
          text: "Hello, how can I help you today?",
          startMs: 1200,
          endMs: 2600,
          latencyMs: null,
          interrupted: true,
          heardText: "Hi, how can",
          audioEndMs: 1500,
        },
      ],
    });
    mockRunsApi([run], { details: { "r-1": interrupted } });
    renderWithClient(<RunDetailContainer runId="r-1" />);

    const transcript = await screen.findByRole("list", { name: "Transcript" });
    const row = within(transcript).getByRole("listitem");
    expect(row).toHaveTextContent("Hello, how can I help you today?");
    expect(row).toHaveTextContent(
      "≈ Heard before the interruption at 1.5 s (estimated from the audio played): “Hi, how can”",
    );
  });

  it("labels the heard part as approximate and says whether the agent confirmed the correction", async () => {
    const agentRow = (heardText: string, confirmed?: boolean) => ({
      role: "agent" as const,
      text: `${heardText} and the rest.`,
      startMs: 1200,
      endMs: 2600,
      latencyMs: null,
      interrupted: true,
      heardText,
      audioEndMs: 1500,
      ...(confirmed === undefined ? {} : { heardTextEstimated: true as const, interruptionConfirmed: confirmed }),
    });
    const interrupted = runDetailFixture({
      transcript: [agentRow("Confirmed part", true), agentRow("Unconfirmed part", false), agentRow("Older part")],
    });
    mockRunsApi([run], { details: { "r-1": interrupted } });
    renderWithClient(<RunDetailContainer runId="r-1" />);

    const transcript = await screen.findByRole("list", { name: "Transcript" });
    const [confirmed, unconfirmed, older] = within(transcript).getAllByRole("listitem");
    const approx = "Approximately heard (estimated from the audio played)";
    expect(within(confirmed).getByTitle(approx)).toHaveTextContent(`${approx}: Confirmed part`);
    expect(within(confirmed).getByText("≈ heard")).toBeInTheDocument();
    expect(within(confirmed).getByText("Correction confirmed by the agent")).toBeInTheDocument();
    expect(within(unconfirmed).getByText("Correction not confirmed")).toBeInTheDocument();
    expect(within(unconfirmed).queryByText("Correction confirmed by the agent")).not.toBeInTheDocument();
    // Older runs carry neither field: the heard part is still an estimate, the confirmation unknown.
    expect(within(older).getByTitle(approx)).toHaveTextContent("Older part");
    expect(within(older).queryByText(/Correction/)).not.toBeInTheDocument();
  });

  it.each([
    ["realtime", "Realtime evaluator"],
    ["pipeline", "Pipeline evaluator"],
  ] as const)("names the %s evaluator the run was launched with", async (evaluatorMode, label) => {
    const launched = runDetailFixture({ snapshot: snapshotFixture({ evaluatorMode }) });
    mockRunsApi([run], { details: { "r-1": launched } });
    renderWithClient(<RunDetailContainer runId="r-1" />);

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it.each([
    ["gpt-realtime-2.1", "Realtime evaluator · gpt-realtime-2.1"],
    ["gpt-realtime-2.1-mini", "Realtime evaluator · gpt-realtime-2.1-mini"],
  ] as const)("names the realtime model %s the run was launched with", async (realtimeModel, label) => {
    const launched = runDetailFixture({ snapshot: snapshotFixture({ evaluatorMode: "realtime", realtimeModel }) });
    mockRunsApi([run], { details: { "r-1": launched } });
    renderWithClient(<RunDetailContainer runId="r-1" />);

    expect(await screen.findByText(label)).toBeInTheDocument();
  });

  it("copies the thread id", async () => {
    mockRunsApi([run], { details: { "r-1": detail } });
    renderWithClient(<RunDetailContainer runId="r-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Copy thread id" }));

    expect(await navigator.clipboard.readText()).toBe(run.threadId);
    expect(screen.getByText("Thread id copied")).toHaveAttribute("role", "status");
  });

  it("re-runs the scenario after confirming it is a new paid run, then opens its live view", async () => {
    const api = mockRunsApi([run], { details: { "r-1": detail } });
    renderWithClient(<RunDetailContainer runId="r-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Re-run" }));
    const dialog = screen.getByRole("dialog", { name: "Start a new paid run?" });
    expect(dialog).toHaveTextContent("“Booking with date change” against Hotel booking assistant");
    expect(dialog).toHaveTextContent("billed");
    expect(api.requests).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Start paid run" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/live?batchId=b-new-1"));
    expect(api.requests).toEqual([{ method: "POST", path: "/runs/r-1/rerun", body: undefined }]);
  });

  it("cancels a re-run without launching anything", async () => {
    const api = mockRunsApi([run], { details: { "r-1": detail } });
    renderWithClient(<RunDetailContainer runId="r-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Re-run" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.requests).toEqual([]);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("says why a re-run was refused: the scenario was deleted (409)", async () => {
    mockRunsApi([run], {
      details: { "r-1": detail },
      rerunError: { status: 409, detail: "The scenario of this run was deleted" },
    });
    renderWithClient(<RunDetailContainer runId="r-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Re-run" }));
    await user.click(screen.getByRole("button", { name: "Start paid run" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "The scenario of this run was deleted",
    );
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("lists why the scenario cannot run (422)", async () => {
    mockRunsApi([run], {
      details: { "r-1": detail },
      rerunError: {
        status: 422,
        detail: [{ type: "value_error", loc: ["body", "scenarioIds", 0], msg: "The agent has no URL", scenarioId: "s-booking" }],
      },
    });
    renderWithClient(<RunDetailContainer runId="r-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Re-run" }));
    await user.click(screen.getByRole("button", { name: "Start paid run" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "Booking with date change: The agent has no URL",
    );
  });

  it("explains why a failed run stopped", async () => {
    const failed = runFixture({ status: "failed", endReason: "tts_failed", error: "speech synthesis failed (TimeoutError)" });
    mockRunsApi([failed], { details: { "r-1": { summary: null, transcript: [] } } });
    renderWithClient(<RunDetailContainer runId="r-1" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("speech synthesis failed (TimeoutError)");
    expect(screen.getByText("Speech synthesis failed")).toBeInTheDocument();
    expect(screen.getByText("Nothing was said in this run.")).toBeInTheDocument();
  });

  it("links an active run to its live view and cancels it", async () => {
    const active = runFixture({ status: "running", endReason: null, endedAt: null });
    const api = mockRunsApi([active]);
    renderWithClient(<RunDetailContainer runId="r-1" />);
    const user = userEvent.setup();

    expect(await screen.findByRole("link", { name: "Watch live" })).toHaveAttribute("href", "/runs/r-1/live");
    expect(screen.getByText(/The recording and transcript appear once the run finishes/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel run" }));
    await waitFor(() => expect(api.requests).toEqual([{ method: "POST", path: "/runs/r-1/cancel", body: undefined }]));
  });

  it("says when a run does not exist", async () => {
    mockRunsApi([]);
    renderWithClient(<RunDetailContainer runId="nope" />);
    expect(await screen.findByText("Run not found")).toBeInTheDocument();
  });
});
