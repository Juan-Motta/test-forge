import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { runCostFixture } from "@/features/pricing/testing";
import { RunsTable } from "./RunsTable";
import { runFixture } from "./testing";
import type { Run } from "./types";

const NOW = Date.parse("2026-10-05T17:00:00Z");

function renderTable(runs: Run[]) {
  render(<RunsTable runs={runs} onCancel={() => {}} now={NOW} />);
  const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
  const rows = screen.getAllByRole("row").slice(1);
  /** The body cells of the column with this header, one per row. */
  const column = (name: string) => {
    const index = headers.indexOf(name);
    expect(index).toBeGreaterThanOrEqual(0);
    return rows.map((row) => within(row).getAllByRole("cell")[index]);
  };
  return { headers, rows, column };
}

describe("Runs table columns", () => {
  it("fits the runs in eight compact columns, without a fixed minimum width", () => {
    const { headers } = renderTable([runFixture()]);

    expect(headers).toEqual(["Scenario", "Duration", "Turns", "p50 latency", "Cost", "Outcome", "Started", "Actions"]);
    // A floor (not the old 80rem) that still fits the ~942 px the table gets at a 1280 px screen.
    expect(screen.getByRole("table", { name: "Runs" }).className).toMatch(/min-w-\[56rem\]/);
  });
});

describe("Runs table scenario cell", () => {
  it("links the scenario to the report and carries the agent, its kind, the persona and the run id", () => {
    const longId = "7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918";
    const runs = [
      runFixture({ id: longId, persona: "Lucía Fernández" }),
      runFixture({ id: "r-text-0001", agentKind: "text", agentName: "Chat desk" }),
    ];
    const { column } = renderTable(runs);
    const [voice, text] = column("Scenario");

    const link = within(voice).getByRole("link", { name: "Booking with date change" });
    expect(link).toHaveAttribute("href", `/runs/${longId}`);
    expect(link).toHaveAttribute("title", "Booking with date change");
    expect(within(voice).getByText("Hotel booking assistant")).toHaveAttribute("title", "Hotel booking assistant");
    expect(within(voice).getByText("Voice")).toBeInTheDocument();
    expect(within(voice).getByText("Lucía Fernández")).toHaveAttribute("title", "Lucía Fernández");
    const id = within(voice).getByText("7f6e5d4c…18");
    expect(id).toHaveAttribute("title", longId);
    expect(within(voice).getByRole("button", { name: "Copy run id 7f6e5d4c…18" })).toBeInTheDocument();

    expect(within(text).getByText("Chat desk")).toBeInTheDocument();
    expect(within(text).getByText("Text")).toBeInTheDocument();
    expect(within(text).getByRole("button", { name: "Copy run id r-text-0001" })).toBeInTheDocument();
  });

  it("truncates long scenario, agent and persona names, keeping the full text in a title", () => {
    const long = runFixture({
      scenarioName: "Booking with a date change and a late check-in request",
      agentName: "Hotel booking assistant (staging, EU region)",
      persona: "Lucía Fernández de la Torre",
    });
    const { column } = renderTable([long]);
    const [cell] = column("Scenario");

    for (const text of [long.scenarioName, long.agentName, "Lucía Fernández de la Torre"]) {
      const element = within(cell).getByText(text);
      expect(element).toHaveAttribute("title", text);
      expect(element).toHaveClass("truncate");
    }
  });
});

describe("Runs table outcome column", () => {
  it("shows the score, the judgement in progress, a failed judgement or a dash", () => {
    const runs = [
      runFixture({ id: "r-scored-1", judgementStatus: "completed", score: 72 }),
      runFixture({ id: "r-judging-1", judgementStatus: "collecting_traces" }),
      runFixture({ id: "r-failed-01", judgementStatus: "failed" }),
      runFixture({ id: "r-never-001" }),
    ];
    const { column } = renderTable(runs);

    expect(column("Outcome").map((cell) => cell.textContent)).toEqual(["72Passed", "Judging…", "Failed", "—"]);
  });

  it("draws the score as a bar and the judged result as a chip", () => {
    const runs = [
      runFixture({ id: "r-passed-01", judgementStatus: "completed", score: 84 }),
      runFixture({ id: "r-review-01", judgementStatus: "completed", score: 41 }),
      runFixture({ id: "r-never-001" }),
      runFixture({ id: "r-must-fail", judgementStatus: "completed", score: 92, mustFailed: true }),
    ];
    const { column } = renderTable(runs);
    const cells = column("Outcome");

    expect(cells.map((cell) => cell.textContent)).toEqual(["84Passed", "41Needs review", "—", "92Needs review"]);
    expect(within(cells[0]).getByRole("meter", { name: "Score of run r-passed-01" })).toHaveAttribute("aria-valuenow", "84");
    expect(within(cells[1]).getByRole("meter")).toHaveAttribute("data-tone", "bad");
    expect(within(cells[2]).getByRole("meter")).toHaveAttribute("aria-valuetext", "Not scored");
  });

  it("shows the status only for a run that did not complete normally or is still going", () => {
    const judged = { judgementStatus: "completed" as const, score: 88 };
    const runs = [
      runFixture({ id: "r-complete", ...judged }),
      runFixture({ id: "r-failed-01", status: "failed", endReason: "tts_failed", ...judged }),
      runFixture({ id: "r-interrupt", status: "interrupted", ...judged }),
      runFixture({ id: "r-cancelled", status: "cancelled", ...judged }),
      runFixture({ id: "r-running01", status: "running", endReason: null, endedAt: null }),
    ];
    const { column } = renderTable(runs);
    const [completed, failed, interrupted, cancelled, running] = column("Outcome");

    expect(within(completed).queryByText("Completed")).not.toBeInTheDocument();
    expect(within(completed).getByText("Passed")).toBeInTheDocument();
    expect(within(failed).getByText("Failed")).toBeInTheDocument();
    expect(within(failed).getByText("Speech synthesis failed")).toBeInTheDocument();
    expect(within(interrupted).getByText("Interrupted")).toBeInTheDocument();
    expect(within(cancelled).getByText("Cancelled")).toBeInTheDocument();
    expect(within(running).getByText("Running")).toBeInTheDocument();
    // A broken or cancelled call is never "Passed", even when its judge scored it.
    for (const cell of [failed, interrupted, cancelled, running]) {
      expect(within(cell).queryByText("Passed")).not.toBeInTheDocument();
    }
  });
});

describe("Runs table call columns", () => {
  it("shows caller / agent turns and the p50 agent latency, or a dash", () => {
    const runs = [
      runFixture({ id: "r-measured", callerTurns: 6, agentTurns: 7, latencyP50Ms: 640 }),
      runFixture({ id: "r-slow-0001", callerTurns: 2, agentTurns: 3, latencyP50Ms: 1800 }),
      runFixture({ id: "r-unknown-1" }),
    ];
    const { column } = renderTable(runs);

    expect(column("Turns").map((cell) => cell.textContent)).toEqual(["6 / 7", "2 / 3", "—"]);
    expect(column("p50 latency").map((cell) => cell.textContent)).toEqual(["640 ms", "1.8 s", "—"]);
  });
});

describe("Runs table cost column", () => {
  it("shows each run's approximate evaluation cost, or a dash before costs", () => {
    const runs = [
      runFixture({ id: "r-priced-1", cost: runCostFixture() }),
      runFixture({ id: "r-partial", cost: runCostFixture({ complete: false }) }),
      runFixture({ id: "r-older-01", cost: null }),
      runFixture({ id: "r-older-02" }),
    ];
    const { column } = renderTable(runs);

    expect(column("Cost").map((cell) => cell.textContent)).toEqual(["≈ $0.4435", "≈ $0.4435+", "—", "—"]);
  });
});

describe("Runs table started column", () => {
  it("shows when each run started, or when it was queued before it starts", () => {
    const runs = [
      runFixture({ id: "r-started-1", startedAt: "2026-10-05T16:55:00Z" }),
      runFixture({ id: "r-queued-01", status: "queued", startedAt: null, endedAt: null, createdAt: "2026-10-05T16:58:00Z" }),
      runFixture({ id: "r-cancel-01", status: "cancelled", startedAt: null, endedAt: "2026-10-05T16:59:00Z", createdAt: "2026-10-05T16:57:00Z" }),
    ];
    const { column } = renderTable(runs);
    const [started, queued, cancelled] = column("Started");

    expect(within(started).getByText("5 minutes ago")).toHaveAttribute("dateTime", "2026-10-05T16:55:00Z");
    expect(within(queued).getByText("2 minutes ago")).toHaveAttribute("dateTime", "2026-10-05T16:58:00Z");
    expect(queued).toHaveTextContent("Not started");
    expect(started).not.toHaveTextContent("Not started");
    expect(cancelled).toHaveTextContent("Not started"); // cancelled while still queued
  });
});

describe("Runs table actions", () => {
  it("offers live and cancel on an active run and opens every run's report", () => {
    const runs = [
      runFixture({ id: "r-live-001", status: "running", endReason: null, endedAt: null }),
      runFixture({ id: "r-done-001" }),
    ];
    const { column } = renderTable(runs);
    const [live, done] = column("Actions");

    expect(within(live).getByRole("link", { name: "Watch run r-live-001 live" })).toHaveAttribute("href", "/runs/r-live-001/live");
    expect(within(live).getByRole("button", { name: "Cancel run r-live-001" })).toBeInTheDocument();
    expect(within(live).getByRole("link", { name: "Open run r-live-001" })).toHaveAttribute("href", "/runs/r-live-001");
    expect(within(done).queryByRole("button", { name: /Cancel/ })).not.toBeInTheDocument();
    expect(within(done).getByRole("link", { name: "Open run r-done-001" })).toHaveAttribute("href", "/runs/r-done-001");
  });
});
