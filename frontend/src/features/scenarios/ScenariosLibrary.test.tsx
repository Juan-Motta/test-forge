import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentFixture, mockAgentsApi } from "@/features/agents/testing";
import { mockRunsApi } from "@/features/runs/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { ScenariosContainer } from "./ScenariosContainer";
import { mockScenariosApi, scenarioFixture } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
}));

const hotel = agentFixture();
const support = agentFixture({ id: "a-support", name: "Support triage" });
const agents = [hotel, support];

const booking = scenarioFixture();
const cancel = scenarioFixture({
  id: "s-cancel",
  name: "Cancel within 24h",
  tags: ["cancellation"],
  persona: { name: "Ana", locale: "es-MX", temperament: "polite", notes: "" },
  criteria: [{ id: "k-9", text: "Confirms the cancellation", kind: "must", source: "transcript", weight: 100 }],
  updatedAt: "2026-10-03T10:00:00Z",
});
const refund = scenarioFixture({
  id: "s-refund",
  agentId: "a-support",
  agent: { id: "a-support", name: "Support triage" },
  name: "Refund dispute",
  tags: ["regression"],
  persona: { name: "Raúl", locale: "es-MX", temperament: "angry", notes: "" },
});

function item(name: string) {
  return screen.getByRole("listitem", { name });
}

describe("Scenarios library", () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
  });

  it("groups scenarios by agent with their tags, temperament and criteria count", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);

    const hotelGroup = await screen.findByRole("region", { name: "Hotel booking assistant" });
    const names = within(hotelGroup).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
    expect(names).toEqual(["Cancel within 24h", "Booking with date change"]);
    const first = within(hotelGroup).getByRole("listitem", { name: "Booking with date change" });
    expect(within(first).getByText("booking")).toBeInTheDocument();
    expect(within(first).getByText("regression")).toBeInTheDocument();
    expect(within(first).getByText("Hurried")).toBeInTheDocument();
    expect(within(first).getByText("2 criteria")).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: "Open Booking with date change" })).toHaveAttribute(
      "href",
      "/scenarios/s-booking",
    );

    const supportGroup = screen.getByRole("region", { name: "Support triage" });
    expect(within(supportGroup).getByRole("listitem", { name: "Refund dispute" })).toBeInTheDocument();
    expect(within(supportGroup).getByText("Angry")).toBeInTheDocument();
  });

  it("filters by agent and by tag", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Support triage" });

    await user.click(screen.getByRole("button", { name: "regression" }));
    expect(screen.getByRole("button", { name: "regression" })).toHaveAttribute("aria-pressed", "true");
    expect(item("Booking with date change")).toBeInTheDocument();
    expect(item("Refund dispute")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Cancel within 24h" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Agent"), "Support triage");
    expect(item("Refund dispute")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Hotel booking assistant" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All tags" }));
    await user.selectOptions(screen.getByLabelText("Agent"), "All agents");
    expect(item("Cancel within 24h")).toBeInTheDocument();
  });

  it("says when no scenario matches the filters and clears them", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Support triage" });

    await user.click(screen.getByRole("button", { name: "cancellation" }));
    await user.selectOptions(screen.getByLabelText("Agent"), "Support triage");
    expect(screen.getByText("No scenarios match these filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(item("Refund dispute")).toBeInTheDocument();
    expect(item("Cancel within 24h")).toBeInTheDocument();
  });

  it("duplicates a scenario and opens the copy", async () => {
    mockAgentsApi(agents);
    const api = mockScenariosApi([booking], { agents });
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Duplicate Booking with date change" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/scenarios/s-new-1"));
    expect(api.requests).toEqual([{ method: "POST", path: "/scenarios/s-booking/duplicate", body: undefined }]);
    expect(api.items.map((scenario) => scenario.name)).toContain("Booking with date change (copy)");
  });

  it("deletes only after the user confirms", async () => {
    mockAgentsApi(agents);
    const api = mockScenariosApi([booking, cancel], { agents });
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Delete Booking with date change" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Booking with date change”?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(api.requests).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Delete Booking with date change" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete scenario" }));

    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Booking with date change" })).not.toBeInTheDocument(),
    );
    expect(api.requests).toEqual([{ method: "DELETE", path: "/scenarios/s-booking", body: undefined }]);
    expect(item("Cancel within 24h")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scenarios", level: 1 })).toHaveFocus();
  });

  it("still deletes another scenario after cancelling a dialog whose delete was in flight", async () => {
    mockAgentsApi(agents);
    const api = mockScenariosApi([booking, cancel], { agents });
    let release: () => void = () => {};
    server.use(
      http.delete(apiUrl("/scenarios/s-booking"), async () => {
        await new Promise<void>((resolve) => (release = resolve));
        api.items = api.items.filter((scenario) => scenario.id !== "s-booking");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Delete Booking with date change" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete scenario" }));
    await screen.findByRole("button", { name: "Deleting…" });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Delete Cancel within 24h" }));
    release();
    await waitFor(() =>
      expect(screen.queryByRole("listitem", { name: "Booking with date change" })).not.toBeInTheDocument(),
    );
    const dialog = screen.getByRole("dialog", { name: "Delete “Cancel within 24h”?" });
    await user.click(await within(dialog).findByRole("button", { name: "Delete scenario" }));

    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Cancel within 24h" })).not.toBeInTheDocument());
    expect(api.requests).toEqual([{ method: "DELETE", path: "/scenarios/s-cancel", body: undefined }]);
  });

  it("offers New scenario in the empty state when agents exist", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([], { agents });
    renderWithClient(<ScenariosContainer />);

    const empty = await screen.findByRole("heading", { name: "No scenarios yet" });
    const state = empty.closest("div")?.parentElement as HTMLElement;
    expect(within(state).getByRole("link", { name: "New scenario" })).toHaveAttribute("href", "/scenarios/new");
  });

  it("disables New scenario until an agent exists and links to Agents", async () => {
    mockAgentsApi([]);
    mockScenariosApi([], { agents: [] });
    renderWithClient(<ScenariosContainer />);

    await screen.findByRole("heading", { name: "No scenarios yet" });
    const buttons = screen.getAllByRole("button", { name: "New scenario" });
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription("Add an agent first: scenarios are written against an agent.");
    }
    expect(screen.getByRole("link", { name: "Add an agent" })).toHaveAttribute("href", "/agents");
  });
});

describe("Scenarios library: launch", () => {
  beforeEach(() => {
    nav.push.mockReset();
  });

  it("launches one scenario from its card", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    const runs = mockRunsApi();
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Support triage" });

    await user.click(within(item("Refund dispute")).getByRole("button", { name: "Launch Refund dispute" }));
    await user.click(within(screen.getByRole("dialog", { name: "Launch Refund dispute" })).getByRole("button", { name: "Launch" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/live?batchId=b-new-1"));
    expect(runs.requests[0].body).toMatchObject({ scenarioIds: ["s-refund"] });
  });

  it("launches the selected scenarios together, in library order", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    const runs = mockRunsApi();
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Support triage" });
    expect(screen.queryByRole("button", { name: /Launch selected/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Select Refund dispute" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Booking with date change" }));
    await user.click(screen.getByRole("button", { name: "Launch selected (2)" }));
    const dialog = screen.getByRole("dialog", { name: "Launch 2 scenarios" });
    await user.click(within(dialog).getByRole("button", { name: "Launch" }));

    await waitFor(() => expect(runs.requests).toHaveLength(1));
    expect(runs.requests[0].body).toMatchObject({ scenarioIds: ["s-booking", "s-refund"] });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/live?batchId=b-new-1"));
  });

  it("launches only the selected scenarios the filters still show, and says how many are hidden", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    const runs = mockRunsApi();
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Support triage" });

    await user.click(screen.getByRole("checkbox", { name: "Select Cancel within 24h" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Refund dispute" }));
    await user.click(screen.getByRole("button", { name: "cancellation" }));
    expect(screen.queryByRole("listitem", { name: "Refund dispute" })).not.toBeInTheDocument();

    expect(screen.getByText("1 scenario selected")).toBeInTheDocument();
    expect(screen.getByText("1 more is hidden by the filters and will not launch.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Launch selected (1)" }));
    await user.click(within(screen.getByRole("dialog", { name: "Launch Cancel within 24h" })).getByRole("button", { name: "Launch" }));

    await waitFor(() => expect(runs.requests).toHaveLength(1));
    expect(runs.requests[0].body).toMatchObject({ scenarioIds: ["s-cancel"] });
  });

  it("keeps a selection hidden by the filters and offers no launch while none is visible", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Support triage" });

    await user.click(screen.getByRole("checkbox", { name: "Select Refund dispute" }));
    await user.click(screen.getByRole("button", { name: "cancellation" }));
    expect(screen.queryByRole("button", { name: /Launch selected/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 selected scenario is hidden by the filters.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All tags" }));
    expect(screen.getByRole("button", { name: "Launch selected (1)" })).toBeInTheDocument();
  });

  it("clears the selection", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Support triage" });

    await user.click(screen.getByRole("checkbox", { name: "Select Cancel within 24h" }));
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("checkbox", { name: "Select Cancel within 24h" })).not.toBeChecked();
    expect(screen.queryByRole("button", { name: /Launch selected/ })).not.toBeInTheDocument();
  });
});
