import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { FlowRunsContainer } from "./FlowRunsContainer";
import { apiFixture, flowRunSummaryFixture, mockFlowRunSummaries } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

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

function setup(runs = [searchRun, crmRun]) {
  server.use(http.get(apiUrl("/apis"), () => HttpResponse.json([apiFixture(), apiFixture({ id: "api-crm", name: "CRM" })])));
  return mockFlowRunSummaries(runs);
}

/** Each row's flow link, in order. */
function rowLinks(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("link")[0].getAttribute("href") ?? "");
}

describe("API flow runs page", () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    nav.search = "";
  });

  it("lists every flow run newest first, each opening its run view", async () => {
    const queries = setup();
    renderWithClient(<FlowRunsContainer />);

    expect(screen.getByRole("heading", { level: 1, name: "Runs" })).toBeInTheDocument();
    expect(screen.getByText("Every run of your API flows: which steps passed and how long they took.")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "API flow runs" });
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Flow",
      "Status",
      "Steps",
      "Duration",
      "When",
    ]);
    expect(rowLinks(table)).toEqual(["/apis/api-shop?flow=f-products&run=fr-1", "/apis/api-crm?flow=f-crm&run=fr-2"]);
    const [first, second] = within(table).getAllByRole("row").slice(1);
    expect(within(first).getByRole("link", { name: "Search products" })).toBeInTheDocument();
    expect(within(first).getByText("Shop API")).toBeInTheDocument();
    expect(within(first).getByText("Failed")).toBeInTheDocument();
    expect(within(first).getByText("2 steps")).toBeInTheDocument();
    expect(within(first).getByText("2.4 s")).toBeInTheDocument();
    expect(within(first).getByRole("time")).toHaveAttribute("dateTime", "2026-10-19T10:00:00Z");
    expect(within(second).getByText("Passed")).toBeInTheDocument();
    expect(within(second).getByText("1 step")).toBeInTheDocument();
    // Cards for phones list the same runs.
    const cards = screen.getByRole("list", { name: "API flow runs" });
    expect(within(cards).getAllByRole("listitem")).toHaveLength(2);
    expect(within(cards).getByRole("link", { name: "Find contact" })).toHaveAttribute("href", "/apis/api-crm?flow=f-crm&run=fr-2");
    expect(screen.getByText("1–2 of 2")).toBeInTheDocument();
    expect(queries).toEqual(["limit=20&offset=0"]);
  });

  it("filters by status and API, in the request and the URL, and clears them", async () => {
    const queries = setup();
    renderWithClient(<FlowRunsContainer />);
    await screen.findByRole("table", { name: "API flow runs" });
    const status = screen.getByRole("combobox", { name: "Status" });
    expect(within(status).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All statuses",
      "Passed",
      "Failed",
    ]);

    await userEvent.selectOptions(status, "Passed");

    expect(nav.replace).toHaveBeenLastCalledWith("/flow-runs?status=passed", { scroll: false });
    await waitFor(() => expect(queries.at(-1)).toBe("limit=20&offset=0&status=passed"));
    await waitFor(() =>
      expect(rowLinks(screen.getByRole("table", { name: "API flow runs" }))).toEqual(["/apis/api-crm?flow=f-crm&run=fr-2"]),
    );

    await screen.findByRole("option", { name: "Shop API" });
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "API" }), "Shop API");

    expect(nav.replace).toHaveBeenLastCalledWith("/flow-runs?status=passed&apiId=api-shop", { scroll: false });
    await waitFor(() => expect(queries.at(-1)).toBe("limit=20&offset=0&status=passed&apiId=api-shop"));
    expect(await screen.findByText("No runs match these filters.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/flow-runs", { scroll: false });
  });

  it("reads the filters and the page from the URL", async () => {
    const queries = setup();
    nav.search = "status=failed&apiId=api-shop";
    renderWithClient(<FlowRunsContainer />);

    const table = await screen.findByRole("table", { name: "API flow runs" });
    expect(rowLinks(table)).toEqual(["/apis/api-shop?flow=f-products&run=fr-1"]);
    expect(queries).toEqual(["limit=20&offset=0&status=failed&apiId=api-shop"]);
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveValue("failed");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "API" })).toHaveValue("api-shop"));
  });

  it("pages 20 runs at a time", async () => {
    const runs = Array.from({ length: 25 }, (_, n) =>
      flowRunSummaryFixture({ id: `fr-${n}`, createdAt: new Date(Date.UTC(2026, 9, 20, 12) - n * 60_000).toISOString() }),
    );
    const queries = setup(runs);
    renderWithClient(<FlowRunsContainer />);

    const table = await screen.findByRole("table", { name: "API flow runs" });
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    expect(screen.getByText("1–20 of 25")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(nav.replace).toHaveBeenLastCalledWith("/flow-runs?page=2", { scroll: false });
    await waitFor(() => expect(screen.getByText("21–25 of 25")).toBeInTheDocument());
    expect(queries.at(-1)).toBe("limit=20&offset=20");
    expect(rowLinks(screen.getByRole("table", { name: "API flow runs" }))[0]).toBe("/apis/api-shop?flow=f-products&run=fr-20");
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("says when there is no API flow run yet, with a way to the flows", async () => {
    setup([]);
    renderWithClient(<FlowRunsContainer />);

    expect(await screen.findByText("No API flow runs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Flows" })).toHaveAttribute("href", "/flows");
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("says when the runs could not be loaded, and tries again", async () => {
    setup();
    let fail = true;
    server.use(
      http.get(apiUrl("/flow-runs"), () =>
        fail
          ? HttpResponse.json({ error: { code: "internal", message: "Database unavailable" } }, { status: 500 })
          : HttpResponse.json({ items: [searchRun], total: 1 }),
      ),
    );
    renderWithClient(<FlowRunsContainer />);

    expect(await screen.findByText("Could not load API flow runs")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    const table = await screen.findByRole("table", { name: "API flow runs" });
    expect(rowLinks(table)).toEqual(["/apis/api-shop?flow=f-products&run=fr-1"]);
  });
});
