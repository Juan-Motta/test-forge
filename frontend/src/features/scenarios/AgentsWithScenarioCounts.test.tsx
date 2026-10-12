import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { agentFixture, mockAgentsApi } from "@/features/agents/testing";
import { mockConnectionsApi } from "@/features/connections/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { AgentsWithScenarioCounts } from "./AgentsWithScenarioCounts";
import { mockScenariosApi, scenarioFixture } from "./testing";

const hotel = agentFixture();
const support = agentFixture({ id: "a-support", name: "Support triage" });

describe("Agents with scenario counts", () => {
  it("shows how many scenarios use each agent", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([hotel, support]);
    mockScenariosApi([scenarioFixture(), scenarioFixture({ id: "s-2", name: "Cancel" })], { agents: [hotel, support] });
    renderWithClient(<AgentsWithScenarioCounts />);

    const rail = await screen.findByRole("complementary", { name: "Agents" });
    const row = await within(rail).findByRole("button", { name: /Hotel booking assistant/ });
    await waitFor(() => expect(row).toHaveTextContent("2 scenarios"));
    expect(within(rail).getByRole("button", { name: /Support triage/ })).toHaveTextContent("0 scenarios");
  });

  it("refuses to delete an agent its scenarios use, with the backend's count", async () => {
    mockConnectionsApi([]);
    const scenarios = mockScenariosApi([scenarioFixture(), scenarioFixture({ id: "s-2", name: "Cancel" })], {
      agents: [hotel],
    });
    mockAgentsApi([hotel], {
      scenarioCount: (id) => scenarios.items.filter((scenario) => scenario.agentId === id).length,
    });
    renderWithClient(<AgentsWithScenarioCounts />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Delete Hotel booking assistant" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete agent" }));

    expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
      "Agent is used by 2 scenario(s)",
    );
  });

  it("leaves the scenario count out when the scenarios cannot be loaded", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([hotel]);
    let failed = false;
    server.use(
      http.get(apiUrl("/scenarios"), () => {
        failed = true;
        return HttpResponse.json({ detail: "Down" }, { status: 503 });
      }),
    );
    renderWithClient(<AgentsWithScenarioCounts />);

    const rail = await screen.findByRole("complementary", { name: "Agents" });
    await waitFor(() => expect(failed).toBe(true));
    expect(within(rail).getByRole("button", { name: /Hotel booking assistant/ })).not.toHaveTextContent("scenario");
  });
});
