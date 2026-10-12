import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { afterEach, describe, expect, it } from "vitest";
import { connectionFixture, mockConnectionsApi } from "@/features/connections/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { AgentsContainer } from "./AgentsContainer";
import { agentFixture, mockAgentsApi } from "./testing";

async function rail() {
  return screen.findByRole("complementary", { name: "Agents" });
}

async function railItem(name: string) {
  return within(await rail()).findByRole("button", { name: new RegExp(name) });
}

const support = agentFixture({
  id: "a-support",
  name: "Support triage",
  protocol: "auto",
  baseUrl: "wss://support.example.net:8443/voice",
  channelId: "support",
  langfuseConnectionId: "c-lf",
});

afterEach(() => window.history.replaceState(null, "", "/"));

describe("Agents rail", () => {
  it("lists every agent with its scenario count and protocol, and selects the first one", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture(), support]);
    renderWithClient(<AgentsContainer scenarioCounts={new Map([["a-hotel", 6], ["a-support", 1]])} />);

    const hotel = await railItem("Hotel booking assistant");
    expect(hotel).toHaveTextContent("6 scenarios · Realtime");
    expect(hotel).toHaveTextContent("Not tested");
    expect(hotel).toHaveAttribute("aria-current", "true");
    const supportItem = await railItem("Support triage");
    expect(supportItem).toHaveTextContent("1 scenario · Auto-detect");
    expect(supportItem).not.toHaveAttribute("aria-current");

    expect(screen.getByRole("heading", { level: 1, name: "Hotel booking assistant" })).toBeInTheDocument();
  });

  it("leaves the scenario count out while it is unknown", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture()]);
    renderWithClient(<AgentsContainer />);

    const hotel = await railItem("Hotel booking assistant");
    expect(hotel).toHaveTextContent("Realtime");
    expect(hotel).not.toHaveTextContent("scenario");
  });

  it("opens the agent a rail card names and keeps it in the address", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture(), support]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    await user.click(await railItem("Support triage"));

    expect(screen.getByRole("heading", { level: 1, name: "Support triage" })).toBeInTheDocument();
    expect(await screen.findByLabelText("WebSocket URL")).toHaveValue("wss://support.example.net:8443/voice");
    expect(window.location.search).toBe("?agent=a-support");
    expect(await railItem("Support triage")).toHaveAttribute("aria-current", "true");
  });

  it("opens the agent named in the address", async () => {
    window.history.replaceState(null, "", "/agents?agent=a-support");
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture(), support]);
    renderWithClient(<AgentsContainer />);

    expect(await screen.findByRole("heading", { level: 1, name: "Support triage" })).toBeInTheDocument();
  });

  it("falls back to the first agent when the address names an unknown one", async () => {
    window.history.replaceState(null, "", "/agents?agent=gone");
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture(), support]);
    renderWithClient(<AgentsContainer />);

    expect(await screen.findByRole("heading", { level: 1, name: "Hotel booking assistant" })).toBeInTheDocument();
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
    mockConnectionsApi([]);
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

    expect(await railItem("Hotel booking assistant")).toBeInTheDocument();
  });

  it("selects a new agent once it is created", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture()]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add agent" }));
    const dialog = await screen.findByRole("dialog", { name: "Add agent" });
    await user.type(await within(dialog).findByLabelText("Name"), "Concierge");
    await user.type(within(dialog).getByLabelText("WebSocket URL"), "wss://concierge.example.com");
    await user.type(within(dialog).getByLabelText("Channel ID"), "c");
    await user.type(within(dialog).getByLabelText("User ID"), "u");
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Concierge" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Created Concierge.");
  });
});

describe("Agents: deleting", () => {
  it("deletes only after the user confirms in a dialog naming the agent", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture(), agentFixture({ id: "a-2", name: "Backup agent" })]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    // Sorted by name, so "Backup agent" opens first.
    await user.click(await railItem("Hotel booking assistant"));
    await user.click(screen.getByRole("button", { name: "Delete Hotel booking assistant" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Hotel booking assistant”?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.requests).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Delete Hotel booking assistant" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete agent" }));

    await waitFor(() =>
      expect(within(screen.getByRole("complementary", { name: "Agents" })).queryByRole("button", { name: /Hotel booking/ })).not.toBeInTheDocument(),
    );
    expect(api.requests).toEqual([{ method: "DELETE", path: "/agents/a-hotel", body: undefined }]);
    const title = screen.getByRole("heading", { level: 1, name: "Backup agent" });
    expect(title).toHaveFocus();
  });

  it("keeps an agent that scenarios still use and says why in the dialog", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture()], { scenarioCount: () => 2 });
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    await railItem("Hotel booking assistant");
    await user.click(screen.getByRole("button", { name: "Delete Hotel booking assistant" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete agent" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Agent is used by 2 scenario(s)");
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Delete or move its scenarios first.");
    expect(await railItem("Hotel booking assistant")).toBeInTheDocument();
  });

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

    await user.click(await railItem("Hotel booking assistant"));
    await user.click(screen.getByRole("button", { name: "Delete Hotel booking assistant" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete agent" }));
    await screen.findByRole("button", { name: "Deleting…" });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await user.click(await railItem("Backup agent"));
    await user.click(screen.getByRole("button", { name: "Delete Backup agent" }));
    release();
    await waitFor(() =>
      expect(within(screen.getByRole("complementary", { name: "Agents" })).queryByRole("button", { name: /Hotel booking/ })).not.toBeInTheDocument(),
    );
    const dialog = screen.getByRole("dialog", { name: "Delete “Backup agent”?" });
    await user.click(await within(dialog).findByRole("button", { name: "Delete agent" }));

    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Agents" })).not.toBeInTheDocument());
    expect(api.requests).toEqual([{ method: "DELETE", path: "/agents/a-2", body: undefined }]);
    expect(screen.getByRole("heading", { name: "No agents yet" })).toBeInTheDocument();
  });

  it("removes an agent that another tab already deleted", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture(), agentFixture({ id: "a-2", name: "Backup agent" })]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();
    await user.click(await railItem("Hotel booking assistant"));
    api.items = api.items.filter((item) => item.id !== "a-hotel"); // gone server-side, still listed here

    await user.click(screen.getByRole("button", { name: "Delete Hotel booking assistant" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete agent" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const list = screen.getByRole("complementary", { name: "Agents" });
    expect(within(list).queryByRole("button", { name: /Hotel booking/ })).not.toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /Backup agent/ })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Deleted Hotel booking assistant.");
  });
});

describe("Langfuse connection select", () => {
  it("offers only Langfuse connections, plus None, when creating", async () => {
    mockConnectionsApi([
      connectionFixture(),
      connectionFixture({ id: "c-lf", name: "Traces", kind: "langfuse" }),
      connectionFixture({ id: "c-lf2", name: "Traces staging", kind: "langfuse" }),
      connectionFixture({ id: "c-sp", name: "Speech", kind: "azure_speech" }),
    ]);
    mockAgentsApi([]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Add your first agent" }));
    const select = await within(screen.getByRole("dialog")).findByLabelText("Langfuse connection");

    const options = within(select).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["None", "Traces", "Traces staging"]);
  });
});
