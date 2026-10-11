import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { RunDetailContainer } from "./RunDetailContainer";
import { mockRunsApi, runDetailFixture, runFixture } from "./testing";

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

    expect(await screen.findByRole("heading", { level: 1, name: "Booking with date change" })).toBeInTheDocument();
    expect(screen.getByText("Hotel booking assistant")).toBeInTheDocument();
    expect(screen.getByText("Lucía · hurried · es-MX")).toBeInTheDocument();
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

    const score = screen.getByRole("region", { name: "Score & suggestions" });
    expect(score).toHaveTextContent("Coming with the judge");
  });

  it("copies the thread id", async () => {
    mockRunsApi([run], { details: { "r-1": detail } });
    renderWithClient(<RunDetailContainer runId="r-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Copy thread id" }));

    expect(await navigator.clipboard.readText()).toBe(run.threadId);
    expect(screen.getByRole("status")).toHaveTextContent("Thread id copied");
  });

  it("re-runs the same scenario once and opens its live view", async () => {
    const api = mockRunsApi([run], { details: { "r-1": detail } });
    renderWithClient(<RunDetailContainer runId="r-1" />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Re-run" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/live?batchId=b-new-1"));
    expect(api.requests[0]).toEqual({
      method: "POST",
      path: "/runs",
      body: { scenarioIds: ["s-booking"], repetitions: 1, concurrency: 1 },
    });
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
