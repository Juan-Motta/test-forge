import { QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockScenariosApi, scenarioFixture } from "@/features/scenarios/testing";
import { renderWithClient } from "@/test/render";
import { RunsContainer } from "./RunsContainer";
import { batchFixture, mockRunsApi, runFixture } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const done = runFixture();
const failed = runFixture({
  id: "r-2",
  status: "failed",
  endReason: "tts_failed",
  error: "speech synthesis failed (TimeoutError)",
  createdAt: "2026-10-05T17:00:00Z",
  startedAt: "2026-10-05T17:00:02Z",
  endedAt: "2026-10-05T17:00:32Z",
});
const running = runFixture({
  id: "r-3",
  batchId: "b-2",
  scenarioId: "s-cancel",
  scenarioName: "Cancel within 24h",
  status: "running",
  endReason: null,
  createdAt: "2026-10-05T18:00:00Z",
  startedAt: "2026-10-05T18:00:01Z",
  endedAt: null,
});

function scenarios() {
  mockScenariosApi([scenarioFixture(), scenarioFixture({ id: "s-cancel", name: "Cancel within 24h" })]);
}

function rowNames() {
  // The first link of each row is its scenario, linked to the report.
  return screen.getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("link")[0].textContent);
}

/** The table row whose scenario links to the report of run `id`. */
function rowOf(table: HTMLElement, id: string): HTMLElement {
  const row = within(table)
    .getAllByRole("row")
    .find((candidate) => within(candidate).queryAllByRole("link").some((link) => link.getAttribute("href") === `/runs/${id}`));
  if (!row) throw new Error(`no row for run ${id}`);
  return row;
}

describe("Runs list", () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
    nav.search = "";
  });

  it("lists runs newest first with their scenario, agent, duration and status", async () => {
    scenarios();
    mockRunsApi([done, failed, running]);
    renderWithClient(<RunsContainer />);

    const table = await screen.findByRole("table", { name: "Runs" });
    expect(rowNames()).toEqual(["Cancel within 24h", "Booking with date change", "Booking with date change"]);
    const row = rowOf(table, "r-2");
    expect(within(row).getByText("Failed")).toBeInTheDocument();
    expect(within(row).getByText("Speech synthesis failed")).toBeInTheDocument();
    expect(within(row).getByText("0:30")).toBeInTheDocument();
    expect(within(row).getByText("Hotel booking assistant")).toBeInTheDocument();
    expect(within(row).getAllByRole("link").map((link) => link.getAttribute("href"))).toContain("/runs/r-2");
    expect(within(row).queryByRole("link", { name: /^Open run/ })).not.toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Cancel/ })).not.toBeInTheDocument();
    const live = rowOf(table, "r-3");
    expect(within(live).getByText("Running")).toBeInTheDocument();
    expect(within(live).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/runs/r-3"]);
  });

  it("filters by status and scenario, and keeps the filters in the URL", async () => {
    scenarios();
    const api = mockRunsApi([done, failed, running]);
    renderWithClient(<RunsContainer />);
    const user = userEvent.setup();
    await screen.findByRole("table", { name: "Runs" });

    await user.selectOptions(screen.getByLabelText("Status"), "failed");
    await waitFor(() => expect(rowNames()).toEqual(["Booking with date change"]));
    expect(api.listQueries.at(-1)).toContain("status=failed");
    expect(nav.replace).toHaveBeenLastCalledWith("/runs?status=failed", { scroll: false });

    await user.selectOptions(screen.getByLabelText("Status"), "");
    await user.selectOptions(screen.getByLabelText("Scenario"), "s-cancel");
    await waitFor(() => expect(rowNames()).toEqual(["Cancel within 24h"]));
    expect(api.listQueries.at(-1)).toContain("scenarioId=s-cancel");
  });

  it("sorts oldest first on request, keeps the order in the URL and goes back to the first page", async () => {
    scenarios();
    nav.search = "page=2";
    const many = Array.from({ length: 25 }, (_, i) =>
      runFixture({
        id: `r-${i + 1}`,
        scenarioName: `Scenario ${i + 1}`,
        createdAt: `2026-10-05T10:${String(i).padStart(2, "0")}:00Z`,
      }),
    );
    const api = mockRunsApi(many);
    renderWithClient(<RunsContainer />);
    const user = userEvent.setup();
    expect(await screen.findByText("21–25 of 25")).toBeInTheDocument();
    const order = screen.getByRole("radiogroup", { name: "Order" });
    expect(within(order).getByRole("radio", { name: "Newest first" })).toBeChecked();

    await user.click(within(order).getByRole("radio", { name: "Oldest first" }));

    expect(await screen.findByText("1–20 of 25")).toBeInTheDocument();
    await waitFor(() => expect(rowNames()[0]).toBe("Scenario 1"));
    expect(api.listQueries.at(-1)).toContain("order=oldest");
    expect(api.listQueries.at(-1)).toContain("offset=0");
    expect(nav.replace).toHaveBeenLastCalledWith("/runs?order=oldest", { scroll: false });
  });

  it("reads the order from the URL", async () => {
    scenarios();
    nav.search = "order=oldest";
    const api = mockRunsApi([done, failed, running]);
    renderWithClient(<RunsContainer />);

    await waitFor(() => expect(rowNames()).toHaveLength(3));
    expect(screen.getByRole("radio", { name: "Oldest first" })).toBeChecked();
    expect(api.listQueries[0]).toContain("order=oldest");
    const reportOf = (row: HTMLElement) => within(row).getAllByRole("link")[0].getAttribute("href");
    expect(screen.getAllByRole("row").slice(1).map(reportOf)).toEqual(["/runs/r-1", "/runs/r-2", "/runs/r-3"]);
  });

  it("shows the same runs as cards for small screens", async () => {
    scenarios();
    mockRunsApi([done, failed, running]);
    renderWithClient(<RunsContainer />);

    const table = await screen.findByRole("table", { name: "Runs" });
    const cards = screen.getByRole("list", { name: "Runs" });
    const tableReports = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("link")[0].getAttribute("href"));
    const items = within(cards).getAllByRole("listitem");
    expect(items.map((item) => within(item).getAllByRole("link")[0].getAttribute("href"))).toEqual(tableReports);
    // The cards keep the run id with its copy button (small screens have no other place to see it).
    expect(within(items[0]).getByRole("button", { name: /^Copy run id / })).toBeInTheDocument();
    expect(within(items[0]).getByRole("link", { name: "Cancel within 24h" })).toHaveAttribute("href", "/runs/r-3");
    // Only one of the two shows at a time: the table on wide screens, the cards below.
    expect(table.closest("div")).toHaveClass("hidden");
    expect(cards).toHaveClass("xl:hidden");
  });

  it("shows only one batch when the URL names it, and can clear that filter", async () => {
    scenarios();
    nav.search = "batchId=b-2";
    const api = mockRunsApi([done, failed, running], {
      batches: [batchFixture({ id: "b-2", label: "nightly", status: "running", total: 1 })],
    });
    renderWithClient(<RunsContainer />);
    const user = userEvent.setup();

    await waitFor(() => expect(screen.queryAllByRole("row").length).toBe(2));
    expect(api.listQueries[0]).toContain("batchId=b-2");
    await user.click(screen.getByRole("button", { name: "Clear batch filter nightly" }));
    await waitFor(() => expect(rowNames()).toHaveLength(3));
  });

  it("follows a URL changed from elsewhere while the page stays mounted", async () => {
    scenarios();
    mockRunsApi([done, failed, running]);
    const { rerender, queryClient } = renderWithClient(<RunsContainer />);
    await waitFor(() => expect(rowNames()).toHaveLength(3));

    nav.search = "status=failed";
    rerender(
      <QueryClientProvider client={queryClient}>
        <RunsContainer />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(rowNames()).toEqual(["Booking with date change"]));
    expect(screen.getByLabelText("Status")).toHaveValue("failed");
  });

  it("pages through the runs 20 at a time", async () => {
    scenarios();
    const many = Array.from({ length: 25 }, (_, i) =>
      runFixture({ id: `r-${i + 1}`, createdAt: `2026-10-05T10:${String(i).padStart(2, "0")}:00Z` }),
    );
    mockRunsApi(many);
    renderWithClient(<RunsContainer />);
    const user = userEvent.setup();

    expect(await screen.findByText("1–20 of 25")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("21–25 of 25")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("moves an out-of-range page to the last page once the total is known", async () => {
    scenarios();
    nav.search = "page=9";
    const many = Array.from({ length: 25 }, (_, i) =>
      runFixture({ id: `r-${i + 1}`, createdAt: `2026-10-05T10:${String(i).padStart(2, "0")}:00Z` }),
    );
    mockRunsApi(many);
    renderWithClient(<RunsContainer />);

    expect(await screen.findByText("21–25 of 25")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(6));
    expect(nav.replace).toHaveBeenCalledWith("/runs?page=2", { scroll: false });
  });

  it("offers no cancel button in the list: a run is cancelled from its own page", async () => {
    scenarios();
    mockRunsApi([done, running]);
    renderWithClient(<RunsContainer />);
    await screen.findByRole("table", { name: "Runs" });
    expect(screen.queryByRole("button", { name: /^Cancel run/ })).not.toBeInTheDocument();
  });

  it("shows recent batches with their progress", async () => {
    scenarios();
    mockRunsApi([], {
      batches: [
        batchFixture({
          id: "b-9",
          label: "Hotel regression",
          status: "running",
          total: 6,
          counts: { completed: 2, running: 3, queued: 1 },
          createdAt: "2026-10-05T19:00:00Z",
        }),
      ],
    });
    renderWithClient(<RunsContainer />);

    const batches = await screen.findByRole("region", { name: "Recent batches" });
    const item = within(batches).getByRole("listitem", { name: "Hotel regression" });
    expect(within(item).getByText("2 of 6 finished")).toBeInTheDocument();
    expect(within(item).getByRole("link", { name: "Watch Hotel regression live" })).toHaveAttribute(
      "href",
      "/live?batchId=b-9",
    );
    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
  });
});

describe("Runs list in Spanish", () => {
  beforeEach(() => {
    nav.search = "";
  });

  it("titles, filters and labels the runs in Spanish, leaving the scenario names as they are", async () => {
    scenarios();
    mockRunsApi([done, failed, running]);
    renderWithClient(<RunsContainer />, { locale: "es" });

    const table = await screen.findByRole("table", { name: "Corridas" });
    expect(screen.getByRole("heading", { level: 1, name: "Corridas y reportes" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Estado" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "Escenario" })).toBeInTheDocument();
    const row = rowOf(table, "r-2");
    expect(within(row).getByText("Fallida")).toBeInTheDocument();
    expect(within(table).getAllByText("Booking with date change").length).toBeGreaterThan(0);
  });
});
