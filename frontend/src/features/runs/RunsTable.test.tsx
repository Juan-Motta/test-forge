import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunsTable } from "./RunsTable";
import { runFixture } from "./testing";

describe("Runs table score column", () => {
  it("shows the score, the judgement in progress, a failed judgement or a dash", () => {
    const runs = [
      runFixture({ id: "r-scored-1", judgementStatus: "completed", score: 72 }),
      runFixture({ id: "r-judging-1", judgementStatus: "collecting_traces" }),
      runFixture({ id: "r-failed-01", judgementStatus: "failed" }),
      runFixture({ id: "r-never-001" }),
    ];
    render(<RunsTable runs={runs} onCancel={() => {}} now={Date.parse("2026-10-05T17:00:00Z")} />);

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    const column = headers.indexOf("Score");
    expect(column).toBeGreaterThan(0);
    const scores = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[column].textContent);
    expect(scores).toEqual(["72", "Judging…", "Failed", "—"]);
  });
});

describe("Runs table call columns", () => {
  it("shows the persona, caller / agent turns and the p50 agent latency, or a dash", () => {
    const runs = [
      runFixture({ id: "r-measured", persona: "Lucía", callerTurns: 6, agentTurns: 7, latencyP50Ms: 640 }),
      runFixture({ id: "r-slow-0001", persona: "Ana", callerTurns: 2, agentTurns: 3, latencyP50Ms: 1800 }),
      runFixture({ id: "r-unknown-1" }),
    ];
    render(<RunsTable runs={runs} onCancel={() => {}} now={Date.parse("2026-10-05T17:00:00Z")} />);

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    const rows = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
    const column = (name: string) => {
      const index = headers.indexOf(name);
      expect(index).toBeGreaterThan(0);
      return rows.map((row) => row[index]);
    };
    expect(column("Persona")).toEqual(["Lucía", "Ana", "—"]);
    expect(column("Turns")).toEqual(["6 / 7", "2 / 3", "—"]);
    expect(column("p50 latency")).toEqual(["640 ms", "1.8 s", "—"]);
  });
});

describe("Runs table design", () => {
  it("draws the score as a bar and the judged result as a chip", () => {
    const runs = [
      runFixture({ id: "r-passed-01", judgementStatus: "completed", score: 84 }),
      runFixture({ id: "r-review-01", judgementStatus: "completed", score: 41 }),
      runFixture({ id: "r-never-001" }),
      runFixture({ id: "r-must-fail", judgementStatus: "completed", score: 92, mustFailed: true }),
    ];
    render(<RunsTable runs={runs} onCancel={() => {}} now={Date.parse("2026-10-05T17:00:00Z")} />);

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    const rows = screen.getAllByRole("row").slice(1);
    const result = headers.indexOf("Result");
    expect(result).toBeGreaterThan(0);
    expect(rows.map((row) => within(row).getAllByRole("cell")[result].textContent)).toEqual([
      "Passed",
      "Needs review",
      "—",
      "Needs review",
    ]);
    expect(within(rows[0]).getByRole("meter", { name: "Score of run r-passed-01" })).toHaveAttribute("aria-valuenow", "84");
    expect(within(rows[1]).getByRole("meter")).toHaveAttribute("data-tone", "bad");
    expect(within(rows[2]).getByRole("meter")).toHaveAttribute("aria-valuetext", "Not scored");
  });

  it("never calls a broken or cancelled call Passed, and leaves unscored runs blank", () => {
    const judged = { judgementStatus: "completed" as const, score: 88 };
    const runs = [
      runFixture({ id: "r-failed-01", status: "failed", ...judged }),
      runFixture({ id: "r-interrupt", status: "interrupted", ...judged }),
      runFixture({ id: "r-cancelled", status: "cancelled", ...judged }),
      runFixture({ id: "r-unscored1", status: "completed", judgementStatus: "completed", score: null }),
      runFixture({ id: "r-running01", status: "running", endedAt: null }),
    ];
    render(<RunsTable runs={runs} onCancel={() => {}} now={Date.parse("2026-10-05T17:00:00Z")} />);

    const headers = screen.getAllByRole("columnheader").map((cell) => cell.textContent);
    const result = headers.indexOf("Result");
    const cells = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[result].textContent);
    // The Status column says what happened to the call; the Result is never "Passed" for it.
    expect(cells).toEqual(["—", "—", "—", "—", "—"]);
  });
});
