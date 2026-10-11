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
