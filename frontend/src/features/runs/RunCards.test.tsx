import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { runCostFixture } from "@/features/pricing/testing";
import { createFormat } from "@/lib/i18n";
import { RunCards } from "./RunCards";
import { runFixture } from "./testing";

const { absoluteTime } = createFormat("en");

const NOW = Date.parse("2026-10-05T17:00:00Z");

describe("Run cards", () => {
  it("shows each run as a card linked to its report, with its agent, result and figures", () => {
    const runs = [
      runFixture({
        id: "r-scored-1",
        judgementStatus: "completed",
        score: 91,
        persona: "Lucía",
        callerTurns: 4,
        agentTurns: 5,
        latencyP50Ms: 640,
        cost: runCostFixture(),
      }),
      runFixture({
        id: "r-text-0001",
        agentKind: "text",
        agentName: "Support chat",
        status: "failed",
        endReason: "agent_error",
      }),
    ];
    render(<RunCards runs={runs} now={NOW} />);

    const list = screen.getByRole("list", { name: "Runs" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first).getByRole("link", { name: "Booking with date change" })).toHaveAttribute(
      "href",
      "/runs/r-scored-1",
    );
    expect(within(first).getByText("Passed")).toBeInTheDocument();
    expect(within(first).getByText("Completed")).toBeInTheDocument();
    expect(within(first).getByText("Hotel booking assistant")).toBeInTheDocument();
    expect(within(first).getByText("Voice")).toBeInTheDocument();
    expect(within(first).getByText("Lucía")).toBeInTheDocument();
    expect(within(first).getByText("4:12")).toBeInTheDocument();
    expect(within(first).getByText("4 / 5")).toBeInTheDocument();
    expect(within(first).getByText("640 ms")).toBeInTheDocument();
    expect(within(first).getByRole("button", { name: "Copy run id r-scored-1" })).toBeInTheDocument();
    expect(within(first).getByText("r-scored-1")).toBeInTheDocument();

    expect(within(second).getByText("Support chat")).toBeInTheDocument();
    expect(within(second).getByText("Text")).toBeInTheDocument();
    expect(within(second).getByText("Failed")).toBeInTheDocument();
  });

  it("shows when a run started, or when it was queued before it starts", () => {
    const runs = [
      runFixture({ id: "r-started-1", startedAt: "2026-10-05T16:55:00Z" }),
      runFixture({ id: "r-queued-01", status: "queued", startedAt: null, endedAt: null, createdAt: "2026-10-05T16:58:00Z" }),
    ];
    render(<RunCards runs={runs} now={NOW} />);

    const [started, queued] = screen.getAllByRole("listitem");
    const startedTime = within(started).getByText("5 minutes ago");
    expect(startedTime).toHaveAttribute("dateTime", "2026-10-05T16:55:00Z");
    expect(startedTime).toHaveAttribute("title", absoluteTime("2026-10-05T16:55:00Z"));
    expect(within(queued).getByText("2 minutes ago")).toHaveAttribute("dateTime", "2026-10-05T16:58:00Z");
  });

  it("offers no live or cancel action: the scenario name opens the run, where both are", () => {
    const runs = [runFixture({ id: "r-live-001", status: "running", endReason: null, endedAt: null })];
    render(<RunCards runs={runs} now={NOW} />);

    const card = screen.getByRole("listitem");
    expect(within(card).queryByRole("link", { name: /live$/ })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /^Cancel run/ })).not.toBeInTheDocument();
    expect(within(card).getAllByRole("link")[0]).toHaveAttribute("href", "/runs/r-live-001");
  });
});
