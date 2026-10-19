import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentFixture, mockAgentsApi } from "@/features/agents/testing";
import { mockRunsApi } from "@/features/runs/testing";
import { renderWithClient } from "@/test/render";
import { GroupContainer } from "./GroupContainer";
import { groupFixture, mockGroupsApi, mockScenariosApi, scenarioFixture } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
}));

const agents = [agentFixture(), agentFixture({ id: "a-support", name: "Support triage" })];
const regression = groupFixture({
  id: "g-regression",
  name: "Regression",
  description: "Everything that broke once.",
  tags: ["nightly"],
});
const ideas = groupFixture({ id: "g-ideas", name: "Ideas" });
const inRegression = { groupId: "g-regression", group: { id: "g-regression", name: "Regression" } };
const booking = scenarioFixture(inRegression);
const refund = scenarioFixture({
  ...inRegression,
  id: "s-refund",
  agentId: "a-support",
  agent: { id: "a-support", name: "Support triage" },
  name: "Refund dispute",
  tags: [],
});
const outside = scenarioFixture({ id: "s-outside", name: "Late check-out", groupId: "g-ideas", group: { id: "g-ideas", name: "Ideas" } });

function setup(groups = [regression, ideas], scenarios = [booking, refund, outside]) {
  mockAgentsApi(agents);
  const scenarioApi = mockScenariosApi(scenarios, { agents, groups });
  const groupApi = mockGroupsApi(groups, { scenarios: scenarioApi });
  return { scenarioApi, groupApi };
}

async function renderGroup(id = "g-regression") {
  const user = userEvent.setup({ delay: null });
  renderWithClient(<GroupContainer groupId={id} />);
  await screen.findByRole("heading", { level: 1 });
  return user;
}

describe("Scenario group page", () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
  });

  it("heads the page with the group's title, description and tags, its scenarios in the sidebar and a placeholder", async () => {
    setup();
    await renderGroup();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Regression");
    expect(screen.getByRole("button", { name: "Rename the group Regression" })).toBeInTheDocument();
    expect(screen.getByText("Everything that broke once.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit the description" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Group tags" })).getByText("nightly")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add tag" })).toBeInTheDocument();
    // No details form and no group card in the sidebar any more.
    expect(screen.queryByRole("region", { name: "Group details" })).not.toBeInTheDocument();

    const library = screen.getByRole("complementary", { name: "Scenario library" });
    expect(within(library).queryByRole("link", { name: /^Group/ })).not.toBeInTheDocument();
    expect(await within(library).findByRole("link", { name: /Booking with date change/ })).toHaveAttribute(
      "href",
      "/scenarios/s-booking",
    );
    expect(within(library).getByRole("link", { name: /Refund dispute/ })).toBeInTheDocument();
    expect(within(library).queryByText("Late check-out")).not.toBeInTheDocument();
    expect(within(library).getByRole("link", { name: "New scenario" })).toHaveAttribute(
      "href",
      "/scenarios/new?group=g-regression",
    );

    expect(screen.getByRole("heading", { name: "Select a scenario" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Launch every scenario of Regression" })).toHaveTextContent("Run all (2)");
  });

  it("edits the title, the description and the tags in place", async () => {
    const { groupApi } = setup();
    const user = await renderGroup();

    await user.click(screen.getByRole("button", { name: "Rename the group Regression" }));
    await user.clear(screen.getByRole("textbox", { name: "Rename the group Regression" }));
    await user.type(screen.getByRole("textbox", { name: "Rename the group Regression" }), "Regression suite{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Regression suite"));

    await user.click(screen.getByRole("button", { name: "Edit the description" }));
    const description = screen.getByRole("textbox", { name: "Edit the description" });
    await user.clear(description);
    await user.type(description, "What must not break again.");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit the description" })).not.toBeInTheDocument());
    expect(screen.getByText("What must not break again.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add tag" }));
    await user.type(screen.getByRole("textbox", { name: "New tag" }), "core{Enter}");
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Group tags" })).getByText("core")).toBeInTheDocument());
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Remove the tag nightly" }));
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Group tags" })).queryByText("nightly")).not.toBeInTheDocument());

    expect(groupApi.requests.map((request) => request.body)).toEqual([
      { name: "Regression suite" },
      { description: "What must not break again." },
      { tags: ["nightly", "core"] },
      { tags: ["core"] },
    ]);
  });

  it("saves the description once and keeps both of two quick tag removals", async () => {
    const { groupApi } = setup([groupFixture({ ...regression, tags: ["nightly", "core", "smoke"] }), ideas]);
    const user = await renderGroup();

    await user.click(screen.getByRole("button", { name: "Edit the description" }));
    const description = screen.getByRole("textbox", { name: "Edit the description" });
    await user.clear(description);
    await user.type(description, "Once.");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await user.tab();
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit the description" })).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Remove the tag nightly" }));
    await user.click(screen.getByRole("button", { name: "Remove the tag core" }));
    await waitFor(() => expect(groupApi.requests).toHaveLength(3));
    expect(groupApi.requests.map((request) => request.body)).toEqual([
      { description: "Once." },
      { tags: ["core", "smoke"] },
      { tags: ["smoke"] },
    ]);
    await waitFor(() =>
      expect(within(screen.getByRole("list", { name: "Group tags" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
        "smoke",
        "Add tag",
      ]),
    );
  });

  it("launches every scenario of the group", async () => {
    setup();
    const runs = mockRunsApi();
    const user = await renderGroup();

    await user.click(await screen.findByRole("button", { name: "Launch every scenario of Regression" }));
    const dialog = screen.getByRole("dialog", { name: "Launch 2 scenarios" });
    await user.click(within(dialog).getByRole("button", { name: /^Launch \d+ runs?$/ }));
    await waitFor(() => expect(runs.requests).toHaveLength(1));
    expect(runs.requests[0].body).toMatchObject({ scenarioIds: ["s-booking", "s-refund"] });
  });

  it("offers no delete while the group holds scenarios", async () => {
    setup();
    await renderGroup();

    expect(screen.queryByRole("button", { name: "Delete Regression" })).not.toBeInTheDocument();
  });

  it("deletes an empty group after a confirmation and goes back to Scenarios", async () => {
    const empty = groupFixture({ id: "g-empty", name: "Empty" });
    const { groupApi } = setup([regression, empty]);
    const user = await renderGroup("g-empty");

    await user.click(await screen.findByRole("button", { name: "Delete Empty" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Empty”?" });
    expect(groupApi.requests).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Delete group" }));

    await waitFor(() => expect(groupApi.requests).toEqual([{ method: "DELETE", path: "/scenario-groups/g-empty", body: undefined }]));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/scenarios"));
  });

  it("says when the group does not exist", async () => {
    setup();
    renderWithClient(<GroupContainer groupId="g-missing" />);

    expect(await screen.findByText("This group does not exist or was deleted.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Scenarios" })).toHaveAttribute("href", "/scenarios");
  });
});
