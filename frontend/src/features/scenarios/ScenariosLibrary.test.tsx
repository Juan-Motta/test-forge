import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentFixture, mockAgentsApi } from "@/features/agents/testing";
import { mockRunsApi } from "@/features/runs/testing";
import { http, HttpResponse } from "msw/http";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { ScenariosContainer } from "./ScenariosContainer";
import { groupFixture, mockGroupsApi, mockScenariosApi, scenarioFixture } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
}));

const hotel = agentFixture();
const support = agentFixture({ id: "a-support", name: "Support triage" });
const agents = [hotel, support];

const regression = groupFixture({
  id: "g-regression",
  name: "Regression",
  description: "Everything that broke once and must not break again.",
  tags: ["nightly", "core"],
});
const smoke = groupFixture({ id: "g-smoke", name: "Smoke", description: "", tags: [] });
const empty = groupFixture({ id: "g-empty", name: "Ideas" });

const booking = scenarioFixture({ groupId: "g-regression", group: { id: "g-regression", name: "Regression" } });
const cancel = scenarioFixture({
  id: "s-cancel",
  name: "Cancel within 24h",
  groupId: "g-regression",
  group: { id: "g-regression", name: "Regression" },
  updatedAt: "2026-10-03T10:00:00Z",
});
const refund = scenarioFixture({
  id: "s-refund",
  agentId: "a-support",
  agent: { id: "a-support", name: "Support triage" },
  name: "Refund dispute",
  groupId: "g-regression",
  group: { id: "g-regression", name: "Regression" },
});
const ping = scenarioFixture({ id: "s-ping", name: "Ping", groupId: "g-smoke", group: { id: "g-smoke", name: "Smoke" } });

function setup(groups = [regression, smoke, empty], scenarios = [booking, cancel, refund, ping]) {
  mockAgentsApi(agents);
  const scenarioApi = mockScenariosApi(scenarios, { agents, groups });
  const groupApi = mockGroupsApi(groups, { scenarios: scenarioApi });
  return { scenarioApi, groupApi };
}

function rowOf(name: string) {
  return screen.getByRole("link", { name }).closest("tr") as HTMLElement;
}

describe("Scenario groups", () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
  });

  it("lists every group with its description, tags, scenario count, agents and latest change", async () => {
    setup();
    renderWithClient(<ScenariosContainer />);

    const table = await screen.findByRole("table", { name: "Scenario groups" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    const row = rowOf("Regression");
    expect(within(row).getByText("Everything that broke once and must not break again.")).toBeInTheDocument();
    expect(within(within(row).getByRole("list", { name: "Tags" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "nightly",
      "core",
    ]);
    expect(within(row).getByText("3 scenarios")).toBeInTheDocument();
    // A group mixes agents: each is named.
    expect(within(within(row).getByRole("list", { name: "Agents" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Hotel booking assistant",
      "Support triage",
    ]);
    expect(within(row).getByRole("time")).toHaveAttribute("dateTime", cancel.updatedAt);
    expect(within(rowOf("Ideas")).getByText("0 scenarios")).toBeInTheDocument();
    // The group's name opens it; scenarios themselves are listed there, not here.
    expect(screen.getByRole("link", { name: "Regression" })).toHaveAttribute("href", "/scenarios/groups/g-regression");
    expect(screen.queryByText("Booking with date change")).not.toBeInTheDocument();
  });

  it("offers quick actions: launch the group's scenarios and add a scenario to it", async () => {
    setup();
    const runs = mockRunsApi();
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "Scenario groups" });
    expect(within(rowOf("Regression")).getByRole("link", { name: "New scenario in Regression" })).toHaveAttribute(
      "href",
      "/scenarios/new?group=g-regression",
    );
    expect(within(rowOf("Ideas")).queryByRole("button", { name: /^Launch / })).not.toBeInTheDocument();

    await user.click(within(rowOf("Regression")).getByRole("button", { name: "Launch every scenario of Regression" }));
    const dialog = screen.getByRole("dialog", { name: "Launch 3 scenarios" });
    await user.click(within(dialog).getByRole("button", { name: /^Launch \d+ runs?$/ }));

    await waitFor(() => expect(runs.requests).toHaveLength(1));
    expect(runs.requests[0].body).toMatchObject({ scenarioIds: ["s-cancel", "s-booking", "s-refund"] });
  });

  it("offers no launch until the scenarios loaded, and says when they could not be", async () => {
    setup();
    server.use(http.get(apiUrl("/scenarios"), () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
    renderWithClient(<ScenariosContainer />);

    await screen.findByRole("table", { name: "Scenario groups" });
    expect(await screen.findByText("The scenarios could not be loaded, so groups cannot be launched from here.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(within(rowOf("Regression")).queryByRole("button", { name: /^Launch / })).not.toBeInTheDocument();
  });

  it("filters the groups by search, agent and tag, and clears the filters", async () => {
    setup();
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    const names = () =>
      within(screen.getByRole("table", { name: "Scenario groups" }))
        .getAllByRole("row")
        .slice(1)
        .map((row) => within(row).getAllByRole("link")[0].textContent);

    await screen.findByRole("table", { name: "Scenario groups" });
    expect(names()).toEqual(["Ideas", "Regression", "Smoke"]);

    // Search matches a title, a description or a tag.
    await user.type(screen.getByRole("searchbox", { name: "Search groups" }), "broke");
    expect(names()).toEqual(["Regression"]);
    await user.clear(screen.getByRole("searchbox", { name: "Search groups" }));

    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "Support triage");
    expect(names()).toEqual(["Regression"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "");

    expect(Array.from((screen.getByRole("combobox", { name: "Tag" }) as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      "",
      "core",
      "nightly",
    ]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Tag" }), "nightly");
    expect(names()).toEqual(["Regression"]);

    await user.type(screen.getByRole("searchbox", { name: "Search groups" }), "zzz");
    expect(screen.getByText("No groups match these filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(names()).toEqual(["Ideas", "Regression", "Smoke"]);
    expect(screen.getByRole("searchbox", { name: "Search groups" })).toHaveValue("");
  });

  it("offers New scenario, which opens the editor on a new group", async () => {
    setup();
    renderWithClient(<ScenariosContainer />);

    await screen.findByRole("table", { name: "Scenario groups" });
    expect(screen.getByRole("link", { name: "New scenario" })).toHaveAttribute("href", "/scenarios/new");
    expect(screen.queryByRole("button", { name: "New group" })).not.toBeInTheDocument();
  });

  it("invites to create the first group when there is none", async () => {
    setup([], []);
    renderWithClient(<ScenariosContainer />);

    expect(await screen.findByRole("heading", { name: "No groups yet" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "New scenario" }).length).toBeGreaterThan(0);
  });
});

describe("Scenario groups in Spanish", () => {
  it("shows the table chrome in Spanish and the group names untouched", async () => {
    setup();
    renderWithClient(<ScenariosContainer />, { locale: "es" });

    await screen.findByRole("table", { name: "Grupos de escenarios" });
    expect(screen.getByRole("heading", { level: 1, name: "Escenarios" })).toBeInTheDocument();
    expect(within(rowOf("Regression")).getByText("3 escenarios")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo escenario" })).toBeInTheDocument();
  });
});
