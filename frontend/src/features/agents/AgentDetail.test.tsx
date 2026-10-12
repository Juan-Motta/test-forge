import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw/http";
import { afterEach, describe, expect, it } from "vitest";
import { connectionFixture, mockConnectionsApi } from "@/features/connections/testing";
import { renderWithClient } from "@/test/render";
import { AgentsContainer } from "./AgentsContainer";
import { agentFixture, connectionTestFixture, mockAgentsApi } from "./testing";

afterEach(() => window.history.replaceState(null, "", "/"));

async function card(name: string) {
  return screen.findByRole("region", { name });
}

const unreachable = connectionTestFixture({
  reachable: false,
  latencyMs: null,
  protocol: null,
  log: [
    { ok: true, message: "Connecting to wss://agent.example.com/ws" },
    { ok: false, message: "Could not connect: the connection was refused or the host is unreachable" },
  ],
});

describe("Agent detail: realtime connection", () => {
  it("shows the URL, the fixed parameters, the per-run thread ID, origin and protocol", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture({ origin: "https://app.example.com" })]);
    renderWithClient(<AgentsContainer />);

    const realtime = await card("Realtime connection");
    expect(within(realtime).getByText("Each run opens its own socket with a fresh threadId")).toBeInTheDocument();
    expect(within(realtime).getByText("Not tested")).toBeInTheDocument();
    expect(within(realtime).getByLabelText("WebSocket URL")).toHaveValue("wss://agent.example.com/ws");
    const params = within(realtime).getByRole("table", { name: "Connection parameters" });
    const channel = within(params).getByRole("row", { name: /channelId/ });
    expect(within(channel).getByLabelText("Channel ID")).toHaveValue("hotel-dev");
    expect(within(channel).getByText("Fixed")).toBeInTheDocument();
    const user = within(params).getByRole("row", { name: /userId/ });
    expect(within(user).getByLabelText("User ID")).toHaveValue("user|KSG|42");
    expect(within(user).getByText("Fixed")).toBeInTheDocument();
    const thread = within(params).getByRole("row", { name: /threadId/ });
    expect(within(thread).getByText("Generated per run")).toBeInTheDocument();
    expect(within(realtime).getByLabelText("Origin header")).toHaveValue("https://app.example.com");
    expect(within(realtime).getByLabelText("Protocol")).toHaveValue("realtime");
  });

  it("runs a connection test and shows a reachable agent's latency and log", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture()]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    const realtime = await card("Realtime connection");
    expect(within(realtime).getByText(/no audio is sent/)).toBeInTheDocument();
    await user.click(within(realtime).getByRole("button", { name: "Run connection test" }));

    expect(await within(realtime).findByText("Reachable · 142 ms")).toBeInTheDocument();
    const log = within(realtime).getByRole("log", { name: "Connection check" });
    expect(within(log).getByText(/Session ready in 142 ms/)).toHaveAttribute("data-ok", "true");
    expect(log).toHaveTextContent("✓ Detected the realtime protocol");
    expect(api.requests).toEqual([{ method: "POST", path: "/agents/a-hotel/test", body: undefined }]);
    const rail = screen.getByRole("complementary", { name: "Agents" });
    expect(within(rail).getByRole("button", { name: /Hotel booking assistant/ })).toHaveTextContent("Reachable");
  });

  it("shows an unreachable agent with the failing step marked", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture()], { connectionTest: () => unreachable });
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    const realtime = await card("Realtime connection");
    await user.click(within(realtime).getByRole("button", { name: "Run connection test" }));

    expect(await within(realtime).findByText("Unreachable")).toBeInTheDocument();
    const log = within(realtime).getByRole("log", { name: "Connection check" });
    const failed = within(log).getByText(/Could not connect/);
    expect(failed).toHaveAttribute("data-ok", "false");
    expect(failed).toHaveTextContent("✗ Could not connect");
    const rail = screen.getByRole("complementary", { name: "Agents" });
    expect(within(rail).getByRole("button", { name: /Hotel booking assistant/ })).toHaveTextContent("Unreachable");
  });

  it("reports a test the server could not run", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture()], {
      connectionTest: () => HttpResponse.json({ detail: "Agent not found" }, { status: 404 }),
    });
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    const realtime = await card("Realtime connection");
    await user.click(within(realtime).getByRole("button", { name: "Run connection test" }));

    expect(await within(realtime).findByRole("alert")).toHaveTextContent(
      "Could not run the connection test: Agent not found",
    );
    expect(within(realtime).getByText("Not tested")).toBeInTheDocument();
    expect(within(realtime).getByRole("button", { name: "Run connection test" })).toBeEnabled();
  });

  it("keeps each agent's test result while switching between them", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture(), agentFixture({ id: "a-2", name: "Backup agent" })], {
      connectionTest: (id) => (id === "a-2" ? unreachable : connectionTestFixture()),
    });
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    // Sorted by name, so "Backup agent" opens first.
    await user.click(within(await card("Realtime connection")).getByRole("button", { name: "Run connection test" }));
    await within(await card("Realtime connection")).findByText("Unreachable");
    const rail = screen.getByRole("complementary", { name: "Agents" });
    await user.click(within(rail).getByRole("button", { name: /Hotel booking assistant/ }));

    expect(within(await card("Realtime connection")).getByText("Not tested")).toBeInTheDocument();
    await user.click(within(rail).getByRole("button", { name: /Backup agent/ }));
    expect(within(await card("Realtime connection")).getByText("Unreachable")).toBeInTheDocument();
  });
});

describe("Agent detail: Langfuse and context", () => {
  it("shows the linked Langfuse connection's host, how traces are matched and how long the judge waits", async () => {
    mockConnectionsApi([
      connectionFixture({
        id: "c-lf",
        name: "Traces",
        kind: "langfuse",
        config: { host: "https://cloud.langfuse.com", publicKey: "pk-lf-1" },
      }),
    ]);
    mockAgentsApi([agentFixture({ langfuseConnectionId: "c-lf" })]);
    renderWithClient(<AgentsContainer />);

    const langfuse = await card("Langfuse traces");
    expect(await within(langfuse).findByLabelText("Langfuse connection")).toHaveValue("c-lf");
    expect(within(langfuse).getByText("Linked")).toBeInTheDocument();
    expect(within(langfuse).getByText("https://cloud.langfuse.com")).toBeInTheDocument();
    expect(within(langfuse).getByText("Matched by threadId (session id)")).toBeInTheDocument();
    expect(within(langfuse).getByText(/waits up to 20 minutes/)).toBeInTheDocument();
  });

  it("says when no Langfuse connection is linked and updates the host as the select changes", async () => {
    mockConnectionsApi([
      connectionFixture({ id: "c-lf", name: "Traces", kind: "langfuse", config: { host: "https://lf.example.com" } }),
    ]);
    mockAgentsApi([agentFixture()]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    const langfuse = await card("Langfuse traces");
    expect(within(langfuse).getByText("Not linked")).toBeInTheDocument();
    await user.selectOptions(await within(langfuse).findByLabelText("Langfuse connection"), "Traces");

    expect(within(langfuse).getByText("https://lf.example.com")).toBeInTheDocument();
  });

  it("edits the name and context in the agent context card", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture()]);
    renderWithClient(<AgentsContainer />);
    const user = userEvent.setup();

    const context = await card("Agent context");
    const field = within(context).getByLabelText("What this agent does — shared by all its scenarios");
    await user.clear(field);
    await user.type(field, "Books rooms.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(api.requests).toEqual([{ method: "PATCH", path: "/agents/a-hotel", body: { context: "Books rooms." } }]),
    );
  });

  it("points to the scenarios for evaluator and judge settings", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture()]);
    renderWithClient(<AgentsContainer />);

    const evaluator = await card("Evaluator and judge");
    expect(within(evaluator).getByRole("link", { name: "Open scenarios" })).toHaveAttribute("href", "/scenarios");
  });
});
