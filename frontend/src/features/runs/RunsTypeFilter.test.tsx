import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFixture, flowRunSummaryFixture, mockFlowRunSummaries } from "@/features/apiflows/testing";
import { mockScenariosApi, scenarioFixture } from "@/features/scenarios/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { RunsContainer } from "./RunsContainer";
import { mockRunsApi, runFixture } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const agentRun = runFixture({ id: "r-1", createdAt: "2026-10-20T10:00:00Z" });
const olderAgentRun = runFixture({ id: "r-2", scenarioName: "Cancel within 24h", createdAt: "2026-10-18T10:00:00Z" });
const searchRun = flowRunSummaryFixture({ id: "fr-1", status: "failed", createdAt: "2026-10-19T10:00:00Z" });
const crmRun = flowRunSummaryFixture({
  id: "fr-2",
  flowId: "f-crm",
  flowName: "Find contact",
  apiId: "api-crm",
  apiName: "CRM",
  status: "passed",
  stepCount: 1,
  durationMs: 640,
  createdAt: "2026-10-17T10:00:00Z",
});

/** The APIs for the API filter, counting how often they were asked for. */
function apis() {
  const calls = { count: 0 };
  server.use(
    http.get(apiUrl("/apis"), () => {
      calls.count += 1;
      return HttpResponse.json([apiFixture(), apiFixture({ id: "api-crm", name: "CRM" })]);
    }),
  );
  return calls;
}

function setup(options: { agentRuns?: Parameters<typeof mockRunsApi>[0]; flowRuns?: Parameters<typeof mockFlowRunSummaries>[0] } = {}) {
  mockScenariosApi([scenarioFixture()]);
  const runsApi = mockRunsApi(options.agentRuns ?? [agentRun, olderAgentRun]);
  const flowQueries = mockFlowRunSummaries(options.flowRuns ?? [searchRun, crmRun]);
  const apiCalls = apis();
  return { runsApi, flowQueries, apiCalls };
}

/** Each row's first link (its run), in order. */
function rowLinks(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("link")[0].getAttribute("href") ?? "");
}

describe("Runs type filter", () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    nav.search = "";
  });

  it("lists agent runs by default, as before, without asking for flow runs", async () => {
    const { flowQueries, apiCalls } = setup();
    renderWithClient(<RunsContainer />);

    const table = await screen.findByRole("table", { name: "Runs" });
    expect(rowLinks(table)).toEqual(["/runs/r-1", "/runs/r-2"]);
    expect(screen.getByRole("combobox", { name: "Type" })).toHaveValue("agents");
    expect(screen.getByRole("combobox", { name: "Scenario" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Batch" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Order" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "API" })).not.toBeInTheDocument();
    expect(flowQueries).toEqual([]);
    expect(apiCalls.count).toBe(0);
  });

  it("switches to API flow runs, each opening its run view, with only the flow filters", async () => {
    const { flowQueries } = setup();
    renderWithClient(<RunsContainer />);
    await screen.findByRole("table", { name: "Runs" });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Type" }), "API flows");

    expect(nav.replace).toHaveBeenLastCalledWith("/runs?type=flows", { scroll: false });
    const table = await screen.findByRole("table", { name: "API flow runs" });
    expect(rowLinks(table)).toEqual([
      "/apis/api-shop?flow=f-products&run=fr-1",
      "/apis/api-crm?flow=f-crm&run=fr-2",
    ]);
    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getByRole("link", { name: "Search products" })).toBeInTheDocument();
    expect(within(row).getByText("Shop API")).toBeInTheDocument();
    expect(within(row).getByText("Failed")).toBeInTheDocument();
    expect(within(row).getByText("2 steps")).toBeInTheDocument();
    expect(within(row).getByText("2.4 s")).toBeInTheDocument();
    expect(within(within(table).getAllByRole("row")[2]).getByText("1 step")).toBeInTheDocument();
    // Cards for phones list the same runs.
    const cards = screen.getByRole("list", { name: "API flow runs" });
    expect(within(cards).getAllByRole("listitem")).toHaveLength(2);

    expect(flowQueries.at(-1)).toBe("limit=20&offset=0");
    expect(screen.queryByRole("combobox", { name: "Scenario" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Batch" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Order" })).not.toBeInTheDocument();
    const status = screen.getByRole("combobox", { name: "Status" });
    expect(within(status).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All statuses",
      "Passed",
      "Failed",
    ]);
    expect(await screen.findByRole("option", { name: "CRM" })).toBeInTheDocument();
  });

  it("filters flow runs by status and API, in the request and the URL", async () => {
    const { flowQueries } = setup();
    nav.search = "type=flows";
    renderWithClient(<RunsContainer />);
    await screen.findByRole("table", { name: "API flow runs" });

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "Passed");

    expect(nav.replace).toHaveBeenLastCalledWith("/runs?type=flows&status=passed", { scroll: false });
    await waitFor(() => expect(flowQueries.at(-1)).toBe("limit=20&offset=0&status=passed"));
    await waitFor(() => expect(rowLinks(screen.getByRole("table", { name: "API flow runs" }))).toEqual(["/apis/api-crm?flow=f-crm&run=fr-2"]));

    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "API" }), "Shop API");

    expect(nav.replace).toHaveBeenLastCalledWith("/runs?type=flows&status=passed&apiId=api-shop", { scroll: false });
    await waitFor(() => expect(flowQueries.at(-1)).toBe("limit=20&offset=0&status=passed&apiId=api-shop"));
    expect(await screen.findByText("No runs match these filters.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/runs?type=flows", { scroll: false });
  });

  it("reads the flow filters from the URL", async () => {
    const { flowQueries, runsApi } = setup();
    nav.search = "type=flows&status=failed&apiId=api-shop";
    renderWithClient(<RunsContainer />);

    const table = await screen.findByRole("table", { name: "API flow runs" });
    expect(rowLinks(table)).toEqual(["/apis/api-shop?flow=f-products&run=fr-1"]);
    expect(flowQueries).toEqual(["limit=20&offset=0&status=failed&apiId=api-shop"]);
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("failed");
    // Agent runs are not asked for.
    expect(runsApi.listQueries).toEqual([]);
  });

  it("says when there is no API flow run yet", async () => {
    setup({ flowRuns: [] });
    nav.search = "type=flows";
    renderWithClient(<RunsContainer />);

    expect(await screen.findByText("No API flow runs yet")).toBeInTheDocument();
  });

  it("merges both kinds newest first under All, each row saying its kind", async () => {
    const { flowQueries, runsApi } = setup();
    nav.search = "type=all";
    renderWithClient(<RunsContainer />);

    const table = await screen.findByRole("table", { name: "Runs" });
    expect(rowLinks(table)).toEqual([
      "/runs/r-1",
      "/apis/api-shop?flow=f-products&run=fr-1",
      "/runs/r-2",
      "/apis/api-crm?flow=f-crm&run=fr-2",
    ]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Voice")).toBeInTheDocument();
    expect(within(rows[1]).getByText("API flow")).toBeInTheDocument();
    expect(screen.getByText("1–4 of 4")).toBeInTheDocument();
    expect(runsApi.listQueries).toEqual(["limit=20&offset=0"]);
    expect(flowQueries).toEqual(["limit=20&offset=0"]);
    expect(screen.queryByText(/Showing the newest/)).not.toBeInTheDocument();
    for (const name of ["Status", "Scenario", "Batch", "API"]) {
      expect(screen.queryByRole("combobox", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("radiogroup", { name: "Order" })).not.toBeInTheDocument();
  });

  it("reads page × 20 of each kind under All, capped at 200 each, and says so", async () => {
    const agentRuns = Array.from({ length: 205 }, (_, n) =>
      runFixture({ id: `r-${n}`, createdAt: new Date(Date.UTC(2026, 9, 20, 12) - n * 120_000).toISOString() }),
    );
    const flowRuns = Array.from({ length: 30 }, (_, n) =>
      flowRunSummaryFixture({ id: `fr-${n}`, createdAt: new Date(Date.UTC(2026, 9, 20, 12) - n * 120_000 - 60_000).toISOString() }),
    );
    const { flowQueries, runsApi } = setup({ agentRuns, flowRuns });
    nav.search = "type=all&page=2";
    renderWithClient(<RunsContainer />);

    const table = await screen.findByRole("table", { name: "Runs" });
    // 200 agent runs (capped) and 30 flow runs.
    expect(screen.getByText("21–40 of 230")).toBeInTheDocument();
    expect(screen.getByText("Showing the newest 200 of each kind; filter by type to see more.")).toBeInTheDocument();
    expect(runsApi.listQueries).toEqual(["limit=40&offset=0"]);
    expect(flowQueries).toEqual(["limit=40&offset=0"]);
    // Alternating, newest first: page 2 starts at the 11th of each.
    expect(rowLinks(table).slice(0, 2)).toEqual(["/runs/r-10", "/apis/api-shop?flow=f-products&run=fr-10"]);
  });
});
