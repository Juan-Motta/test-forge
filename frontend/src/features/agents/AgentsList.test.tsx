import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { connectionFixture, mockConnectionsApi } from "@/features/connections/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { AgentsContainer } from "./AgentsContainer";
import { agentFixture, mockAgentsApi } from "./testing";

async function findRow(name: string) {
  return screen.findByRole("row", { name: new RegExp(name) });
}

describe("Agents list", () => {
  it("shows each agent with its protocol, target host and channel, and Langfuse link", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([
      agentFixture(),
      agentFixture({
        id: "a-support",
        name: "Support triage",
        protocol: "auto",
        baseUrl: "wss://support.example.net:8443/voice",
        channelId: "support",
        langfuseConnectionId: "c-lf",
      }),
    ]);
    renderWithClient(<AgentsContainer />);

    const hotel = await findRow("Hotel booking assistant");
    expect(within(hotel).getByText("Realtime")).toBeInTheDocument();
    expect(within(hotel).getByText("agent.example.com")).toBeInTheDocument();
    expect(within(hotel).getByText("hotel-dev")).toBeInTheDocument();
    expect(within(hotel).getByText("Not linked")).toBeInTheDocument();

    const support = await findRow("Support triage");
    expect(within(support).getByText("Auto-detect")).toBeInTheDocument();
    expect(within(support).getByText("support.example.net:8443")).toBeInTheDocument();
    expect(within(support).getByText("Linked")).toBeInTheDocument();
    expect(within(support).getByRole("button", { name: "Edit Support triage" })).toBeInTheDocument();
    expect(within(support).getByRole("button", { name: "Delete Support triage" })).toBeInTheDocument();
  });

  it("shows an empty state whose call to action opens the create dialog", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "No agents yet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add your first agent" }));

    expect(await screen.findByRole("dialog", { name: "Add agent" })).toBeInTheDocument();
  });

  it("shows an error with a retry when the list cannot be loaded", async () => {
    let calls = 0;
    server.use(
      http.get(apiUrl("/agents"), () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ detail: "Database unavailable" }, { status: 503 })
          : HttpResponse.json([agentFixture()]);
      }),
    );
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load agents");
    expect(screen.getByRole("alert")).toHaveTextContent("Database unavailable");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await findRow("Hotel booking assistant")).toBeInTheDocument();
  });

  it("deletes only after the user confirms in a dialog naming the agent", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture(), agentFixture({ id: "a-2", name: "Backup agent" })]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("Hotel booking assistant")).getByRole("button", { name: "Delete Hotel booking assistant" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Hotel booking assistant”?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.requests).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Delete Hotel booking assistant" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete agent" }));

    await waitFor(() => expect(screen.queryByRole("row", { name: /Hotel booking assistant/ })).not.toBeInTheDocument());
    expect(api.requests).toEqual([{ method: "DELETE", path: "/agents/a-hotel", body: undefined }]);
    expect(screen.getByRole("row", { name: /Backup agent/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agents" })).toHaveFocus();
  });

  it("keeps an agent that scenarios still use and says why in the dialog", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture()], { scenarioCount: () => 2 });
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("Hotel booking assistant")).getByRole("button", { name: "Delete Hotel booking assistant" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete agent" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Agent is used by 2 scenario(s)");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Delete or move its scenarios first.");
    expect(screen.getByRole("row", { name: /Hotel booking assistant/ })).toBeInTheDocument();
  });
});

describe("Agents list: deleting", () => {
  it("still deletes another agent after cancelling a dialog whose delete was in flight", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture(), agentFixture({ id: "a-2", name: "Backup agent" })]);
    let release: () => void = () => {};
    server.use(
      http.delete(apiUrl("/agents/a-hotel"), async () => {
        await new Promise<void>((resolve) => (release = resolve));
        api.items = api.items.filter((item) => item.id !== "a-hotel");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("Hotel booking assistant")).getByRole("button", { name: "Delete Hotel booking assistant" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete agent" }));
    await screen.findByRole("button", { name: "Deleting…" });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Delete Backup agent" }));
    release();
    await waitFor(() => expect(screen.queryByRole("row", { name: /Hotel booking assistant/ })).not.toBeInTheDocument());
    const dialog = screen.getByRole("dialog", { name: "Delete “Backup agent”?" });
    await user.click(await within(dialog).findByRole("button", { name: "Delete agent" }));

    await waitFor(() => expect(screen.queryByRole("row", { name: /Backup agent/ })).not.toBeInTheDocument());
    expect(api.requests).toEqual([{ method: "DELETE", path: "/agents/a-2", body: undefined }]);
  });

  it("removes an agent that another tab already deleted", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture(), agentFixture({ id: "a-2", name: "Backup agent" })]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();
    await findRow("Hotel booking assistant");
    api.items = api.items.filter((item) => item.id !== "a-hotel"); // gone server-side, still listed here

    await user.click(screen.getByRole("button", { name: "Delete Hotel booking assistant" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete agent" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("row", { name: /Hotel booking assistant/ })).not.toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Backup agent/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Deleted Hotel booking assistant.");
  });
});

describe("Langfuse connection select", () => {
  it("offers only Langfuse connections, plus None", async () => {
    mockConnectionsApi([
      connectionFixture(),
      connectionFixture({ id: "c-lf", name: "Traces", kind: "langfuse" }),
      connectionFixture({ id: "c-lf2", name: "Traces staging", kind: "langfuse" }),
      connectionFixture({ id: "c-sp", name: "Speech", kind: "azure_speech" }),
    ]);
    mockAgentsApi([]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add agent" }));
    const select = await within(screen.getByRole("dialog")).findByLabelText("Langfuse connection");

    const options = within(select).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["None", "Traces", "Traces staging"]);
  });
});
