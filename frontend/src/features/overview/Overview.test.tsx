import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { mockRunsApi, runFixture } from "@/features/runs/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { OverviewContainer } from "./OverviewContainer";
import { mockStatsApi, statsFixture } from "./testing";

const kpi = (name: string) => screen.getByRole("group", { name });

describe("Overview header", () => {
  it("titles the last 7 days and starts a new run from the scenarios", async () => {
    mockRunsApi([runFixture()]);
    mockStatsApi();
    renderWithClient(<OverviewContainer />);
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("Last 7 days across all agents")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New run" })).toHaveAttribute("href", "/scenarios");
    await screen.findByRole("region", { name: "Recent runs" });
  });
});

describe("Overview KPIs", () => {
  it("shows runs vs the previous week, the average score /100, goal completion and latency", async () => {
    mockRunsApi([runFixture()]);
    const api = mockStatsApi(statsFixture());
    renderWithClient(<OverviewContainer />);

    await screen.findByRole("group", { name: "Runs · last 7 days" });
    expect(api.queries).toContain("days=7");
    expect(kpi("Runs · last 7 days")).toHaveTextContent("128");
    expect(kpi("Runs · last 7 days")).toHaveTextContent("+34 vs previous week");
    expect(kpi("Average judge score")).toHaveTextContent("74.2/ 100");
    expect(kpi("Goal completion")).toHaveTextContent("81%");
    expect(kpi("Agent turn latency · p50")).toHaveTextContent("1.2s");
    expect(kpi("Agent turn latency · p50")).toHaveTextContent("p95 2.9 s");
  });

  it("shows a dash, never 0, for metrics without data", async () => {
    mockRunsApi([runFixture()]);
    mockStatsApi(
      statsFixture({
        runs: { count: 3, previousCount: 5 },
        averageScore: null,
        goalCompletion: null,
        latency: { p50Ms: null, p95Ms: null },
      }),
    );
    renderWithClient(<OverviewContainer />);

    await screen.findByRole("group", { name: "Average judge score" });
    expect(kpi("Runs · last 7 days")).toHaveTextContent("−2 vs previous week");
    expect(kpi("Average judge score")).toHaveTextContent("—");
    expect(kpi("Average judge score")).toHaveTextContent("No judged runs yet");
    expect(kpi("Goal completion")).toHaveTextContent("—");
    expect(kpi("Agent turn latency · p50")).toHaveTextContent("—");
    expect(kpi("Agent turn latency · p50")).not.toHaveTextContent("p95");
  });

  it("shows unknown metrics, not 0, when the stats cannot be loaded", async () => {
    mockRunsApi([runFixture()]);
    mockStatsApi({ status: 500, detail: "Database unavailable" });
    renderWithClient(<OverviewContainer />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Some metrics could not be loaded");
    expect(alert).toHaveTextContent("Database unavailable");
    expect(kpi("Runs · last 7 days")).toHaveTextContent("—");
    expect(kpi("Goal completion")).toHaveTextContent("—");
    expect(screen.getByRole("region", { name: "Recent runs" })).toBeInTheDocument();
  });
});

describe("Overview while the metrics load", () => {
  it("shows the recent runs and the live strip without waiting for the metrics", async () => {
    mockRunsApi([runFixture()]);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get(apiUrl("/stats/overview"), async () => {
        await held;
        return HttpResponse.json(statsFixture());
      }),
    );
    renderWithClient(<OverviewContainer />);

    expect(await screen.findByRole("region", { name: "Recent runs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: /Live now/ })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading overview" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Key metrics" })).toHaveAttribute("aria-busy", "true");
    expect(kpi("Runs · last 7 days")).toHaveTextContent("—");
    expect(screen.getAllByText("Loading metrics…").length).toBeGreaterThan(0);

    release();
    await waitFor(() => expect(kpi("Runs · last 7 days")).toHaveTextContent("128"));
    expect(screen.getByRole("region", { name: "Key metrics" })).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText("Loading metrics…")).not.toBeInTheDocument();
  });
});

describe("Overview live strip", () => {
  it("shows up to 3 running calls with their elapsed time and a way to listen in", async () => {
    mockRunsApi([
      runFixture({ id: "r-live-1", status: "running", endedAt: null, createdAt: "2026-10-05T16:01:00Z" }),
      runFixture({ id: "r-live-2", status: "running", endedAt: null, createdAt: "2026-10-05T16:02:00Z" }),
      runFixture({ id: "r-live-3", status: "running", endedAt: null, createdAt: "2026-10-05T16:03:00Z" }),
      runFixture({ id: "r-live-4", status: "running", endedAt: null, persona: "Laura", scenarioName: "Price objection", createdAt: "2026-10-05T16:04:00Z" }),
    ]);
    mockStatsApi();
    renderWithClient(<OverviewContainer />);

    const live = await screen.findByRole("region", { name: "Live now" });
    await within(live).findByText("4 sessions");
    const sessions = within(live).getAllByRole("article");
    expect(sessions).toHaveLength(3);
    const listen = within(live).getAllByRole("link", { name: /Listen in/ });
    // /live focuses a batch (it takes `batchId`), so each card opens its run's batch.
    expect(listen.map((link) => link.getAttribute("href"))).toEqual([
      "/live?batchId=b-1",
      "/live?batchId=b-1",
      "/live?batchId=b-1",
    ]);
    const laura = within(live).getByRole("article", { name: "Price objection" });
    expect(laura).toHaveTextContent("Laura");
    expect(within(laura).getByText(/^\d+(:\d\d)+$/)).toBeInTheDocument();
    expect(within(live).getByRole("link", { name: "Open live monitor" })).toHaveAttribute("href", "/live");
  });

  it("says when nothing is live, and keeps polling for new calls", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = mockRunsApi([runFixture({ id: "r-1" })]);
      mockStatsApi();
      renderWithClient(<OverviewContainer />);
      const live = await screen.findByRole("region", { name: "Live now" });
      expect(await within(live).findByText("Nothing running right now.")).toBeInTheDocument();

      api.runs.push(runFixture({ id: "r-2", status: "running", endedAt: null, createdAt: "2026-10-05T17:00:00Z" }));
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      await waitFor(() => expect(within(live).getAllByRole("article")).toHaveLength(1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an unknown session count, not 0, when the live calls cannot be loaded", async () => {
    mockRunsApi([runFixture({ id: "r-1" })]);
    mockStatsApi();
    server.use(
      http.get(apiUrl("/runs"), ({ request }) =>
        new URL(request.url).searchParams.get("status") === "running"
          ? HttpResponse.json({ detail: "Database unavailable" }, { status: 500 })
          : undefined,
      ),
    );
    renderWithClient(<OverviewContainer />);
    const live = await screen.findByRole("region", { name: "Live now" });
    expect(await within(live).findByText("— sessions")).toBeInTheDocument();
    expect(within(live).getByText(/Could not load live runs/)).toBeInTheDocument();
  });
});

describe("Overview recent runs", () => {
  const runs = [
    runFixture({ id: "r-pass-0001", judgementStatus: "completed", score: 88, persona: "Marco", createdAt: "2026-10-05T16:04:00Z" }),
    runFixture({ id: "r-review-01", judgementStatus: "completed", score: 52, scenarioName: "Price objection", createdAt: "2026-10-05T16:03:00Z" }),
    runFixture({ id: "r-failed-01", status: "failed", endReason: "tts_failed", scenarioName: "Cancel within 24h", createdAt: "2026-10-05T16:02:00Z" }),
  ];

  it("lists runs with a score bar and a result chip, linked to their reports", async () => {
    mockRunsApi(runs);
    mockStatsApi();
    renderWithClient(<OverviewContainer />);

    const recent = await screen.findByRole("region", { name: "Recent runs" });
    const table = await within(recent).findByRole("table", { name: "Recent runs" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByRole("link", { name: "Booking with date change" })).toHaveAttribute("href", "/runs/r-pass-0001");
    expect(within(rows[0]).queryByRole("button", { name: /^Copy run id / })).not.toBeInTheDocument();
    expect(within(rows[0]).getByText("Passed")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Marco")).toBeInTheDocument();
    expect(within(rows[0]).getByRole("meter", { name: "Score of run r-pass-0001" })).toHaveAttribute("aria-valuenow", "88");
    expect(within(rows[1]).getByText("Needs review")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Failed")).toBeInTheDocument();
  });

  it("shows the same recent runs as cards for small screens", async () => {
    mockRunsApi(runs);
    mockStatsApi();
    renderWithClient(<OverviewContainer />);

    const recent = await screen.findByRole("region", { name: "Recent runs" });
    const table = await within(recent).findByRole("table", { name: "Recent runs" });
    const cards = within(recent).getByRole("list", { name: "Recent runs" });
    const items = within(cards).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByRole("link", { name: "Booking with date change" })).toHaveAttribute(
      "href",
      "/runs/r-pass-0001",
    );
    expect(within(items[0]).getByText("Passed")).toBeInTheDocument();
    expect(within(items[1]).getByText("Needs review")).toBeInTheDocument();
    expect(within(items[2]).getByText("Failed")).toBeInTheDocument();
    expect(within(items[0]).getByRole("button", { name: /^Copy run id / })).toBeInTheDocument();
    expect(table.parentElement).toHaveClass("hidden");
    expect(cards).toHaveClass("lg:hidden");
  });

  it("puts the run's agent, persona and id under its scenario, ellipsized with the full text in a title", async () => {
    const longId = "7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918";
    const long = runFixture({
      id: longId,
      scenarioName: "Booking with a date change and a late check-in request",
      agentName: "Hotel booking assistant (staging, EU region)",
      persona: "Lucía Fernández",
    });
    mockRunsApi([long]);
    mockStatsApi();
    renderWithClient(<OverviewContainer />);

    const table = await screen.findByRole("table", { name: "Recent runs" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Scenario",
      "Duration",
      "Score",
      "Result",
      "When",
    ]);
    const link = within(table).getByRole("link", { name: long.scenarioName });
    expect(link).toHaveAttribute("href", `/runs/${longId}`);
    expect(within(table).queryByText("7f6e5d4c…18")).not.toBeInTheDocument();
    for (const text of [long.scenarioName, long.agentName, "Lucía Fernández"]) {
      const cell = within(table).getByText(text);
      expect(cell).toHaveAttribute("title", text);
      expect(cell).toHaveClass("truncate");
    }
    expect(table).toHaveClass("table-fixed");
    expect(table.className).not.toMatch(/min-w-/);
  });

  it("filters the table to failed runs or runs that need review", async () => {
    const user = userEvent.setup();
    mockRunsApi(runs);
    mockStatsApi();
    renderWithClient(<OverviewContainer />);
    const recent = await screen.findByRole("region", { name: "Recent runs" });
    await within(recent).findByRole("table", { name: "Recent runs" });
    const names = () =>
      within(recent)
        .queryAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("link")[0].textContent);

    await user.click(within(recent).getByRole("button", { name: "Failed" }));
    expect(within(recent).getByRole("button", { name: "Failed" })).toHaveAttribute("aria-pressed", "true");
    expect(names()).toEqual(["Cancel within 24h"]);

    await user.click(within(recent).getByRole("button", { name: "Needs review" }));
    expect(names()).toEqual(["Price objection"]);

    await user.click(within(recent).getByRole("button", { name: "All" }));
    expect(names()).toHaveLength(3);
  });

  it("narrows the recent runs with the header search", async () => {
    const user = userEvent.setup();
    mockRunsApi(runs);
    mockStatsApi();
    renderWithClient(<OverviewContainer />);
    const recent = await screen.findByRole("region", { name: "Recent runs" });
    await within(recent).findByRole("table", { name: "Recent runs" });

    await user.type(screen.getByRole("searchbox", { name: "Search runs" }), "price");
    expect(within(recent).getAllByRole("row").slice(1)).toHaveLength(1);
    await user.clear(screen.getByRole("searchbox", { name: "Search runs" }));
    await user.type(screen.getByRole("searchbox", { name: "Search runs" }), "nothing like this");
    expect(within(recent).getByText("No recent runs match.")).toBeInTheDocument();
  });

  it("invites a first launch when nothing ran yet", async () => {
    mockRunsApi([]);
    mockStatsApi(statsFixture({ runs: { count: 0, previousCount: 0 }, averageScore: null, goalCompletion: null }));
    renderWithClient(<OverviewContainer />);
    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to scenarios" })).toHaveAttribute("href", "/scenarios");
  });
});

describe("Overview weakest criteria and suggestions", () => {
  it("lists the weakest criteria with their score bar and the open suggestions", async () => {
    mockRunsApi([runFixture()]);
    mockStatsApi(
      statsFixture({
        weakestCriteria: [
          { text: "Confirms price before booking", scenarioName: "Booking with date change", averageScore: 51.4, judged: 6 },
          { text: "Reads back the confirmation code", scenarioName: "Cancel within 24h", averageScore: 69, judged: 3 },
        ],
        suggestions: { open: 12, highPriority: 4 },
      }),
    );
    renderWithClient(<OverviewContainer />);

    const weakest = await screen.findByRole("region", { name: "Weakest criteria" });
    const items = await within(weakest).findAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Confirms price before booking");
    expect(items[0]).toHaveTextContent("Booking with date change");
    expect(items[0]).toHaveTextContent("51.4");
    expect(within(items[0]).getByRole("meter")).toHaveAttribute("data-tone", "bad");
    expect(within(items[1]).getByRole("meter")).toHaveAttribute("data-tone", "warn");

    const suggestions = screen.getByRole("region", { name: "Suggestions ready for handoff" });
    expect(within(suggestions).getByRole("group", { name: "open" })).toHaveTextContent("12");
    expect(within(suggestions).getByRole("group", { name: "high impact" })).toHaveTextContent("4");
    expect(within(suggestions).getByRole("link", { name: "Review suggestions" })).toHaveAttribute("href", "/runs");
  });

  it("explains empty criteria and suggestions", async () => {
    mockRunsApi([runFixture()]);
    mockStatsApi(statsFixture());
    renderWithClient(<OverviewContainer />);
    const weakest = await screen.findByRole("region", { name: "Weakest criteria" });
    expect(await within(weakest).findByText("No judged criteria in the last 7 days.")).toBeInTheDocument();
    const suggestions = screen.getByRole("region", { name: "Suggestions ready for handoff" });
    expect(within(suggestions).getByText("No suggestions to hand off yet.")).toBeInTheDocument();
  });
});

describe("Overview in Spanish", () => {
  it("shows the KPIs with Spanish words and number notation", async () => {
    mockRunsApi([runFixture()]);
    mockStatsApi(statsFixture());
    renderWithClient(<OverviewContainer />, { locale: "es" });

    await screen.findByRole("group", { name: "Corridas · últimos 7 días" });
    expect(screen.getByRole("heading", { level: 1, name: "Resumen" })).toBeInTheDocument();
    expect(kpi("Corridas · últimos 7 días")).toHaveTextContent("+34 frente al periodo anterior (semana)");
    expect(kpi("Puntuación promedio del juez")).toHaveTextContent("74,2");
    expect(kpi("Objetivos cumplidos")).toHaveTextContent("81 %");
  });
});
