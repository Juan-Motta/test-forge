import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentFixture, mockAgentsApi } from "@/features/agents/testing";
import { mockRunsApi } from "@/features/runs/testing";
import { renderWithClient } from "@/test/render";
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

const quiet = agentFixture({ id: "a-quiet", name: "Quiet desk", kind: "text", textMode: "stream", auth: "none", userId: null });

function rowOf(name: string) {
  const link = screen.getByRole("link", { name });
  return link.closest("tr") as HTMLElement;
}

describe("Scenarios by agent", () => {
  beforeEach(() => {
    nav.push.mockReset();
    nav.replace.mockReset();
  });

  it("lists every agent with its kind, scenario count, tags and latest change", async () => {
    mockAgentsApi([...agents, quiet]);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);

    const table = await screen.findByRole("table", { name: "Scenarios by agent" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    const hotelRow = rowOf("Hotel booking assistant");
    expect(within(hotelRow).getByText("Voice")).toBeInTheDocument();
    expect(within(hotelRow).getByText("2 scenarios")).toBeInTheDocument();
    expect(within(within(hotelRow).getByRole("list", { name: "Tags" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "booking",
      "cancellation",
      "regression",
    ]);
    expect(within(hotelRow).getByRole("time")).toHaveAttribute("dateTime", cancel.updatedAt);
    expect(within(rowOf("Support triage")).getByText("1 scenario")).toBeInTheDocument();
    const quietRow = rowOf("Quiet desk");
    expect(within(quietRow).getByText("Text")).toBeInTheDocument();
    expect(within(quietRow).getByText("0 scenarios")).toBeInTheDocument();
    // No scenario names on this page: they live in each agent's library.
    expect(screen.queryByText("Booking with date change")).not.toBeInTheDocument();
  });

  it("opens an agent's newest scenario (Cancel within 24h, updated last) from its name, or a new one when it has none", async () => {
    mockAgentsApi([...agents, quiet]);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />);

    await screen.findByRole("table", { name: "Scenarios by agent" });
    expect(screen.getByRole("link", { name: "Hotel booking assistant" })).toHaveAttribute("href", "/scenarios/s-cancel");
    expect(screen.getByRole("link", { name: "Support triage" })).toHaveAttribute("href", "/scenarios/s-refund");
    expect(screen.getByRole("link", { name: "Quiet desk" })).toHaveAttribute("href", "/scenarios/new?agent=a-quiet");
    expect(within(rowOf("Hotel booking assistant")).getByRole("link", { name: "New scenario for Hotel booking assistant" })).toHaveAttribute(
      "href",
      "/scenarios/new?agent=a-hotel",
    );
    expect(within(rowOf("Quiet desk")).queryByRole("button", { name: /^Launch all/ })).not.toBeInTheDocument();
  });

  it("launches every scenario of an agent with its quick action", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    const runs = mockRunsApi();
    renderWithClient(<ScenariosContainer />);
    const user = userEvent.setup();

    await screen.findByRole("table", { name: "Scenarios by agent" });
    await user.click(screen.getByRole("button", { name: "Launch all Hotel booking assistant scenarios" }));
    const dialog = screen.getByRole("dialog", { name: "Launch 2 scenarios" });
    await user.click(within(dialog).getByRole("button", { name: /^Launch \d+ runs?$/ }));

    await waitFor(() => expect(runs.requests).toHaveLength(1));
    expect(runs.requests[0].body).toMatchObject({ scenarioIds: ["s-cancel", "s-booking"] });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/live?batchId=b-new-1"));
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

describe("Scenarios by agent in Spanish", () => {
  it("shows the table chrome in Spanish and the agent names untouched", async () => {
    mockAgentsApi(agents);
    mockScenariosApi([booking, cancel, refund], { agents });
    renderWithClient(<ScenariosContainer />, { locale: "es" });

    await screen.findByRole("table", { name: "Escenarios por agente" });
    expect(screen.getByRole("heading", { level: 1, name: "Escenarios" })).toBeInTheDocument();
    expect(within(rowOf("Hotel booking assistant")).getByText("2 escenarios")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanzar todos los escenarios de Hotel booking assistant" })).toBeInTheDocument();
  });
});
