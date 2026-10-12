import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { connectionFixture, mockConnectionsApi } from "@/features/connections/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { AgentsContainer } from "./AgentsContainer";
import { agentFixture, mockAgentsApi } from "./testing";

async function openCreate() {
  const user = userEvent.setup();
  renderWithClient(<AgentsContainer />);
  await user.click(await screen.findByRole("button", { name: "Add agent" }));
  const dialog = await screen.findByRole("dialog", { name: "Add agent" });
  await within(dialog).findByLabelText("Name");
  return { user, dialog };
}

/** The selected agent's inline form; its "Save changes" button sits in the page header. */
async function openEdit(name = "Hotel booking assistant") {
  const user = userEvent.setup();
  renderWithClient(<AgentsContainer />);
  await screen.findByRole("heading", { level: 1, name });
  const dialog = await screen.findByRole("form", { name: "Agent settings" });
  await within(dialog).findByLabelText("Name");
  return { user, dialog };
}

const saveChanges = () => screen.getByRole("button", { name: "Save changes" });

describe("Create agent", () => {
  it("creates an agent with the camelCase payload and shows it in the list", async () => {
    mockConnectionsApi([connectionFixture({ id: "c-lf", name: "Traces", kind: "langfuse" })]);
    const api = mockAgentsApi([]);
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "  Hotel desk ");
    await user.type(
      within(dialog).getByLabelText("What this agent does — shared by all its scenarios"),
      "Books rooms at Hotel Mirador.",
    );
    expect(within(dialog).getByLabelText("Protocol")).toHaveValue("auto");
    await user.selectOptions(within(dialog).getByLabelText("Protocol"), "Realtime");
    await user.type(within(dialog).getByLabelText("WebSocket URL"), "wss://agent.example.com/ws/");
    await user.type(within(dialog).getByLabelText("Channel ID"), "hotel-dev");
    await user.type(within(dialog).getByLabelText("User ID"), "user|KSG|42");
    await user.selectOptions(within(dialog).getByLabelText("Langfuse connection"), "Traces");
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests).toEqual([
      {
        method: "POST",
        path: "/agents",
        body: {
          name: "Hotel desk",
          context: "Books rooms at Hotel Mirador.",
          protocol: "realtime",
          baseUrl: "wss://agent.example.com/ws/",
          channelId: "hotel-dev",
          userId: "user|KSG|42",
          origin: null,
          langfuseConnectionId: "c-lf",
        },
      },
    ]);
    expect(await screen.findByRole("heading", { level: 1, name: "Hotel desk" })).toBeInTheDocument();
  });

  it("checks fields locally, describes the errors and focuses the first one", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([]);
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("WebSocket URL"), "https://agent.example.com?x=1");
    await user.type(within(dialog).getByLabelText("Channel ID"), "bad channel");
    await user.type(within(dialog).getByLabelText("Origin (optional)"), "https://app.example.com/path");
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    const name = within(dialog).getByLabelText("Name");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAccessibleDescription(expect.stringContaining("Enter a name."));
    expect(within(dialog).getByLabelText("WebSocket URL")).toHaveAccessibleDescription(
      expect.stringContaining("URL must not contain a query string or fragment."),
    );
    expect(within(dialog).getByLabelText("Channel ID")).toHaveAccessibleDescription(
      expect.stringContaining("Use only letters, digits and . _ ~ -"),
    );
    expect(within(dialog).getByLabelText("User ID")).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByLabelText("Origin (optional)")).toHaveAccessibleDescription(
      expect.stringContaining("Origin must be only scheme, host and port."),
    );
    expect(api.requests).toEqual([]);
  });

  it("leaves ws://localhost to the server and shows its verdict on the URL field", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([]);
    server.use(
      http.post(apiUrl("/agents"), () =>
        HttpResponse.json(
          {
            detail: [
              {
                type: "value_error",
                loc: ["body", "baseUrl"],
                msg: "URL must use wss (ws://localhost is accepted only when ENVIRONMENT=development)",
              },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Local agent");
    await user.type(within(dialog).getByLabelText("WebSocket URL"), "ws://localhost:8080/ws");
    await user.type(within(dialog).getByLabelText("Channel ID"), "local");
    await user.type(within(dialog).getByLabelText("User ID"), "dev");
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    const url = within(dialog).getByLabelText("WebSocket URL");
    await waitFor(() =>
      expect(url).toHaveAccessibleDescription(expect.stringContaining("ws://localhost is accepted only when")),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Check the highlighted fields.");
    expect(url).toHaveFocus();
  });

  it("puts a taken name on the name field", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture()]);
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Hotel booking assistant");
    await user.type(within(dialog).getByLabelText("WebSocket URL"), "wss://x.example.com");
    await user.type(within(dialog).getByLabelText("Channel ID"), "c");
    await user.type(within(dialog).getByLabelText("User ID"), "u");
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    await waitFor(() =>
      expect(within(dialog).getByLabelText("Name")).toHaveAccessibleDescription(
        expect.stringContaining("An agent with this name already exists."),
      ),
    );
  });

  it("sends a single request when Create is clicked twice", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([]);
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Twice");
    await user.type(within(dialog).getByLabelText("WebSocket URL"), "wss://x.example.com");
    await user.type(within(dialog).getByLabelText("Channel ID"), "c");
    await user.type(within(dialog).getByLabelText("User ID"), "u");
    const create = within(dialog).getByRole("button", { name: "Create agent" });
    await user.dblClick(create);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });
});

describe("Edit agent", () => {
  it("prefills the stored values and sends only what changed", async () => {
    mockConnectionsApi([connectionFixture({ id: "c-lf", name: "Traces", kind: "langfuse" })]);
    const api = mockAgentsApi([
      agentFixture({ origin: "https://app.example.com", langfuseConnectionId: "c-lf" }),
    ]);
    const { user, dialog } = await openEdit();

    expect(within(dialog).getByLabelText("Protocol")).toHaveValue("realtime");
    expect(within(dialog).getByLabelText("Langfuse connection")).toHaveValue("c-lf");
    await user.clear(within(dialog).getByLabelText("Channel ID"));
    await user.type(within(dialog).getByLabelText("Channel ID"), "hotel-prod");
    await user.clear(within(dialog).getByLabelText("Origin header"));
    await user.selectOptions(within(dialog).getByLabelText("Langfuse connection"), "None");
    await user.click(saveChanges());

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved Hotel booking assistant."));
    expect(api.requests).toEqual([
      {
        method: "PATCH",
        path: "/agents/a-hotel",
        body: { channelId: "hotel-prod", origin: null, langfuseConnectionId: null },
      },
    ]);
  });

  it("sends no request when nothing changed and says so", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture()]);
    const { user } = await openEdit();

    await user.click(saveChanges());

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No changes to save."));
    expect(api.requests).toEqual([]);
  });

  it("puts a taken name on the inline name field and keeps the edits", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture(), agentFixture({ id: "a-2", name: "Backup agent" })]);
    const { user, dialog } = await openEdit("Backup agent");

    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Hotel booking assistant");
    await user.click(saveChanges());

    await waitFor(() =>
      expect(within(dialog).getByLabelText("Name")).toHaveAccessibleDescription(
        expect.stringContaining("An agent with this name already exists."),
      ),
    );
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Hotel booking assistant");
  });

  it("refreshes the form with the saved values", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture()]);
    const { user, dialog } = await openEdit();

    const name = within(dialog).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Hotel desk");
    await user.click(saveChanges());

    expect(await screen.findByRole("heading", { level: 1, name: "Hotel desk" })).toBeInTheDocument();
    expect(within(screen.getByRole("form", { name: "Agent settings" })).getByLabelText("Name")).toHaveValue("Hotel desk");
  });
});

// Copied verbatim from Safari's "Copy as cURL" on a vivi.bot realtime socket.
const CURL_SAMPLE = `curl 'wss://api-dev-95a8b1f8-0925-4b65-a078-75c0473d54d7.vivi.bot/channelApi/2a8204d3-bd82-4799-a8e8-8e669f318fec/realtime?voiceCapability=live-v1&userId=waad%7CKSG%7Cdef6b5db-b7ad-4888-bcb3-6ce1c16e2ead&threadId=1786f832-77e7-4b1b-9ea6-ecc7982ce73f' \\
-X 'GET' \\
-H 'Origin: https://portal-dev-95a8b1f8-0925-4b65-a078-75c0473d54d7.vivi.bot' \\
-H 'Pragma: no-cache' \\
-H 'Sec-WebSocket-Version: 13' \\
-H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15'`;

async function importCurl(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, command: string) {
  const toggle = within(dialog).getByRole("button", { name: "Import from cURL" });
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const textarea = within(dialog).getByLabelText("Paste the cURL command");
  expect(textarea).toHaveFocus();
  await user.paste(command);
  await user.click(within(dialog).getByRole("button", { name: "Import" }));
  return toggle;
}

describe("Import from cURL", () => {
  it("fills only the connection fields it finds and creates the agent with them", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([]);
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Vivi dev");
    await user.selectOptions(within(dialog).getByLabelText("Protocol"), "Live");
    const toggle = await importCurl(user, dialog, CURL_SAMPLE);

    expect(within(dialog).getByLabelText("WebSocket URL")).toHaveValue(
      "wss://api-dev-95a8b1f8-0925-4b65-a078-75c0473d54d7.vivi.bot",
    );
    expect(within(dialog).getByLabelText("Channel ID")).toHaveValue("2a8204d3-bd82-4799-a8e8-8e669f318fec");
    expect(within(dialog).getByLabelText("User ID")).toHaveValue("waad|KSG|def6b5db-b7ad-4888-bcb3-6ce1c16e2ead");
    expect(within(dialog).getByLabelText("Origin (optional)")).toHaveValue(
      "https://portal-dev-95a8b1f8-0925-4b65-a078-75c0473d54d7.vivi.bot",
    );
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Vivi dev");
    expect(within(dialog).getByLabelText("Protocol")).toHaveValue("live");
    expect(within(dialog).queryByLabelText("Paste the cURL command")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
    const summary = within(dialog).getByRole("status");
    expect(summary).toHaveTextContent("Filled: WebSocket URL, channel ID, user ID, origin.");
    expect(summary).toHaveTextContent("Ignored: voiceCapability, threadId.");

    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests).toEqual([
      {
        method: "POST",
        path: "/agents",
        body: {
          name: "Vivi dev",
          context: "",
          protocol: "live",
          baseUrl: "wss://api-dev-95a8b1f8-0925-4b65-a078-75c0473d54d7.vivi.bot",
          channelId: "2a8204d3-bd82-4799-a8e8-8e669f318fec",
          userId: "waad|KSG|def6b5db-b7ad-4888-bcb3-6ce1c16e2ead",
          origin: "https://portal-dev-95a8b1f8-0925-4b65-a078-75c0473d54d7.vivi.bot",
          langfuseConnectionId: null,
        },
      },
    ]);
  });

  it("keeps fields the command lacks when editing, warns about them and saves only the changes", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture()]);
    const { user, dialog } = await openEdit();

    await importCurl(
      user,
      dialog,
      `curl "https://agent.example.com/channelApi/hotel-prod/realtime" -H "Origin: https://app.example.com"`,
    );

    expect(within(dialog).getByLabelText("User ID")).toHaveValue("user|KSG|42");
    const summary = within(dialog).getByRole("status");
    expect(summary).toHaveTextContent("Filled: WebSocket URL, channel ID, origin.");
    expect(summary).toHaveTextContent("No userId query parameter; enter the user ID yourself.");

    await user.click(saveChanges());

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests).toEqual([
      {
        method: "PATCH",
        path: "/agents/a-hotel",
        body: { baseUrl: "wss://agent.example.com", channelId: "hotel-prod", origin: "https://app.example.com" },
      },
    ]);
  });

  it("imports a local ws:// agent with a local Origin and creates it", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([]);
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Vivi local");
    await importCurl(
      user,
      dialog,
      `curl 'ws://localhost:8000/channelApi/2a8204d3-bd82-4799-a8e8-8e669f318fec/realtime?userId=u%7Clocal&threadId=t-1' -H 'Origin: http://localhost:3001'`,
    );

    expect(within(dialog).getByLabelText("WebSocket URL")).toHaveValue("ws://localhost:8000");
    expect(within(dialog).getByLabelText("Origin (optional)")).toHaveValue("http://localhost:3001");
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests[0].body).toMatchObject({
      baseUrl: "ws://localhost:8000",
      channelId: "2a8204d3-bd82-4799-a8e8-8e669f318fec",
      userId: "u|local",
      origin: "http://localhost:3001",
    });
  });

  it("accepts a ws:// URL on host.docker.internal", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture()]);
    const { user, dialog } = await openEdit();

    const url = within(dialog).getByLabelText("WebSocket URL");
    await user.clear(url);
    await user.type(url, "ws://host.docker.internal:8000");
    await user.click(saveChanges());

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toEqual({ baseUrl: "ws://host.docker.internal:8000" });
  });

  it("explains a command without a URL and changes nothing", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture()]);
    const { user, dialog } = await openEdit();

    await importCurl(user, dialog, "curl -X GET -H 'Pragma: no-cache'");

    const textarea = within(dialog).getByLabelText("Paste the cURL command");
    expect(textarea).toHaveAccessibleDescription(
      expect.stringContaining("No ws://, wss://, http:// or https:// URL found in the command."),
    );
    expect(textarea).toHaveFocus();
    expect(within(dialog).getByLabelText("WebSocket URL")).toHaveValue("wss://agent.example.com/ws");
  });

  it("closes the panel with Cancel or Escape, keeping the dialog open and returning focus", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([]);
    const { user, dialog } = await openCreate();
    const toggle = within(dialog).getByRole("button", { name: "Import from cURL" });

    await user.click(toggle);
    await user.click(within(dialog).getByRole("button", { name: "Cancel import" }));
    expect(within(dialog).queryByLabelText("Paste the cURL command")).not.toBeInTheDocument();
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    await user.keyboard("{Escape}");
    expect(within(dialog).queryByLabelText("Paste the cURL command")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add agent" })).toBeInTheDocument();
    expect(toggle).toHaveFocus();
  });
});
