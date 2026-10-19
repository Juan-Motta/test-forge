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
  interruptions: [
    { agentTurn: 1, afterMs: 2000 },
    { agentTurn: 3, afterMs: 4500 },
  ],
  evaluatorMode: "realtime",
  updatedAt: "2026-10-03T10:00:00Z",
});
const refund = scenarioFixture({
  id: "s-refund",
  agentId: "a-support",
  agent: { id: "a-support", name: "Support triage" },
  name: "Refund dispute",
  tags: ["regression"],
  persona: { name: "Raúl", locale: "es-MX", temperament: "angry", notes: "" },
  evaluatorMode: "realtime",
  realtimeModel: "gpt-realtime-2.1",
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
    expect(within(first).queryByText(/Interrupts/)).not.toBeInTheDocument();
    expect(within(first).queryByText(/Realtime/)).not.toBeInTheDocument();
    const second = within(hotelGroup).getByRole("listitem", { name: "Cancel within 24h" });
    expect(within(second).getByText("Interrupts 2 replies")).toBeInTheDocument();
    expect(within(second).getByText("Realtime mini")).toBeInTheDocument();
    // The title opens the scenario; launch, duplicate and delete are icon buttons (named, with a tooltip).
    expect(within(first).getByRole("link", { name: "Booking with date change" })).toHaveAttribute(
      "href",
      "/scenarios/s-booking",
    );
    expect(within(first).queryByRole("link", { name: /^Open / })).not.toBeInTheDocument();
    for (const name of [/^Launch /, /^Duplicate /, /^Delete /]) {
      const action = within(first).getByRole("button", { name });
      expect(action).toHaveAttribute("title");
      expect(action.textContent).toBe("");
    }

    const supportGroup = screen.getByRole("region", { name: "Support triage" });
    expect(within(supportGroup).getByRole("listitem", { name: "Refund dispute" })).toBeInTheDocument();
    expect(within(supportGroup).getByText("Angry")).toBeInTheDocument();
    expect(within(supportGroup).getByText("Realtime 2.1")).toBeInTheDocument();
  });

  it("filters by agent, then by that agent's tags only", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Support triage" });
    // Across every agent the tags would be a wall of chips: they appear once an agent is picked.
    expect(screen.queryByRole("group", { name: "Filter by tag" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Agent"), "Hotel booking assistant");
    const tags = screen.getByRole("group", { name: "Filter by tag" });
    expect(within(tags).getAllByRole("button").map((button) => button.textContent)).toEqual([
      "All tags",
      "booking",
      "cancellation",
      "regression",
    ]);
    expect(screen.queryByRole("region", { name: "Support triage" })).not.toBeInTheDocument();
    await user.click(within(tags).getByRole("button", { name: "cancellation" }));
    expect(item("Cancel within 24h")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Booking with date change" })).not.toBeInTheDocument();

    // Another agent starts without a tag filter (the old tag may not exist there).
    await user.selectOptions(screen.getByLabelText("Agent"), "Support triage");
    expect(item("Refund dispute")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Filter by tag" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All tags",
      "regression",
    ]);
    await user.selectOptions(screen.getByLabelText("Agent"), "All agents");
    expect(item("Cancel within 24h")).toBeInTheDocument();
  });

  it("searches scenarios by name or tag", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Support triage" });

    await user.type(screen.getByRole("searchbox", { name: "Search scenarios" }), "CANCEL");
    expect(item("Cancel within 24h")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Booking with date change" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Support triage" })).not.toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Search scenarios" }));
    await user.type(screen.getByRole("searchbox", { name: "Search scenarios" }), "regression");
    expect(item("Booking with date change")).toBeInTheDocument();
    expect(item("Refund dispute")).toBeInTheDocument();
    expect(screen.queryByRole("listitem", { name: "Cancel within 24h" })).not.toBeInTheDocument();
  });

  it("heads each agent's panel with its kind and count, and collapses it", async () => {
    mockAgentsApi([hotel, agentFixture({ id: "a-support", name: "Support triage", kind: "text", textMode: "stream", auth: "none", userId: null })]);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();

    const hotelGroup = await screen.findByRole("region", { name: "Hotel booking assistant" });
    expect(within(hotelGroup).getByText("Voice")).toBeInTheDocument();
    expect(within(hotelGroup).getByText("2 scenarios")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Support triage" })).getByText("Text")).toBeInTheDocument();

    const toggle = within(hotelGroup).getByRole("button", { name: "Hide Hotel booking assistant's scenarios" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(hotelGroup).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(item("Refund dispute")).toBeInTheDocument();
    await user.click(within(hotelGroup).getByRole("button", { name: "Show Hotel booking assistant's scenarios" }));
    expect(within(hotelGroup).getAllByRole("checkbox")).toHaveLength(2);
  });

  it("says when no scenario matches the filters and clears them", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Support triage" });

    await user.selectOptions(screen.getByLabelText("Agent"), "Support triage");
    await user.type(screen.getByRole("searchbox", { name: "Search scenarios" }), "cancellation");
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
    await user.click(within(screen.getByRole("dialog", { name: "Launch Refund dispute" })).getByRole("button", { name: /^Launch \d+ runs?$/ }));

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
    await user.click(within(dialog).getByRole("button", { name: /^Launch \d+ runs?$/ }));

    await waitFor(() => expect(runs.requests).toHaveLength(1));
    expect(runs.requests[0].body).toMatchObject({ scenarioIds: ["s-booking", "s-refund"] });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/live?batchId=b-new-1"));
  });

  it("launches every scenario an agent's panel shows with Launch all", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    const runs = mockRunsApi();
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();

    const hotelGroup = await screen.findByRole("region", { name: "Hotel booking assistant" });
    await user.click(within(hotelGroup).getByRole("button", { name: "Launch all Hotel booking assistant scenarios" }));
    const dialog = screen.getByRole("dialog", { name: "Launch 2 scenarios" });
    await user.click(within(dialog).getByRole("button", { name: /^Launch \d+ runs?$/ }));

    await waitFor(() => expect(runs.requests).toHaveLength(1));
    expect(runs.requests[0].body).toMatchObject({ scenarioIds: ["s-cancel", "s-booking"] });
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
    await user.type(screen.getByRole("searchbox", { name: "Search scenarios" }), "cancellation");
    expect(screen.queryByRole("listitem", { name: "Refund dispute" })).not.toBeInTheDocument();

    expect(screen.getByText("1 scenario selected")).toBeInTheDocument();
    expect(screen.getByText("1 more is hidden by the filters and will not launch.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Launch selected (1)" }));
    await user.click(within(screen.getByRole("dialog", { name: "Launch Cancel within 24h" })).getByRole("button", { name: /^Launch \d+ runs?$/ }));

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
    await user.type(screen.getByRole("searchbox", { name: "Search scenarios" }), "cancellation");
    expect(screen.queryByRole("button", { name: /Launch selected/ })).not.toBeInTheDocument();
    expect(screen.getByText("1 selected scenario is hidden by the filters.")).toBeInTheDocument();

    await user.clear(screen.getByRole("searchbox", { name: "Search scenarios" }));
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

describe("Scenarios library in Spanish", () => {
  it("shows the library chrome in Spanish and the scenario data untouched", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />, { locale: "es" });

    const hotelGroup = await screen.findByRole("region", { name: "Hotel booking assistant" });
    expect(screen.getByRole("heading", { level: 1, name: "Escenarios" })).toBeInTheDocument();
    const first = within(hotelGroup).getByRole("listitem", { name: "Booking with date change" });
    expect(within(first).getByRole("button", { name: "Lanzar Booking with date change" })).toBeInTheDocument();
    expect(within(first).getByText("2 criterios")).toBeInTheDocument();
    expect(within(item("Cancel within 24h")).getByText("1 criterio")).toBeInTheDocument();
  });
});
