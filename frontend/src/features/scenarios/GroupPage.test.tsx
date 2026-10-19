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

  it("shows the group's scenarios in the sidebar beside its details", async () => {
    setup();
    await renderGroup();

    expect(screen.getByRole("heading", { level: 1, name: "Regression" })).toBeInTheDocument();
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Scenarios" })).toHaveAttribute("href", "/scenarios");
    const library = screen.getByRole("complementary", { name: "Scenario library" });
    expect(within(library).getByRole("link", { name: /^Group/ })).toHaveAttribute("aria-current", "page");
    expect(await within(library).findByRole("link", { name: /Booking with date change/ })).toHaveAttribute(
      "href",
      "/scenarios/s-booking",
    );
    // Scenarios of another agent in the same group are listed; other groups' are not.
    expect(within(library).getByRole("link", { name: /Refund dispute/ })).toBeInTheDocument();
    expect(within(library).queryByText("Late check-out")).not.toBeInTheDocument();
    expect(within(library).getByRole("link", { name: "New scenario" })).toHaveAttribute(
      "href",
      "/scenarios/new?group=g-regression",
    );

    const details = screen.getByRole("region", { name: "Group details" });
    expect(within(details).getByLabelText("Title")).toHaveValue("Regression");
    expect(within(details).getByLabelText("Description")).toHaveValue("Everything that broke once.");
    expect(within(details).getByLabelText("Tags")).toHaveValue("nightly");
    expect(within(details).getByText("2 scenarios")).toBeInTheDocument();
  });

  it("saves the edited details", async () => {
    const { groupApi } = setup();
    const user = await renderGroup();
    const details = screen.getByRole("region", { name: "Group details" });

    await user.clear(within(details).getByLabelText("Description"));
    await user.type(within(details).getByLabelText("Description"), "What must not break again.");
    await user.type(within(details).getByLabelText("Tags"), ", core");
    await user.click(within(details).getByRole("button", { name: "Save group" }));

    await waitFor(() => expect(groupApi.requests).toHaveLength(1));
    expect(groupApi.requests[0]).toEqual({
      method: "PATCH",
      path: "/scenario-groups/g-regression",
      body: { name: "Regression", description: "What must not break again.", tags: ["nightly", "core"] },
    });
    expect(await within(details).findByText("Saved")).toBeInTheDocument();
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

  it("explains why a group with scenarios cannot be deleted", async () => {
    setup();
    await renderGroup();

    expect(screen.queryByRole("button", { name: "Delete Regression" })).not.toBeInTheDocument();
    expect(screen.getByText("Move or delete its 2 scenarios to delete this group.")).toBeInTheDocument();
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
