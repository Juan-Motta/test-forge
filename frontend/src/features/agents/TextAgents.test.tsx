import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { mockConnectionsApi } from "@/features/connections/testing";
import { renderWithClient } from "@/test/render";
import { AgentsContainer } from "./AgentsContainer";
import { agentFixture, connectionTestFixture, mockAgentsApi } from "./testing";

afterEach(() => window.history.replaceState(null, "", "/"));

const CHANNEL = "2a8204d3-bd82-4799-a8e8-8e669f318fec";

const chatAgent = agentFixture({
  id: "a-chat",
  name: "Chat desk",
  kind: "text",
  protocol: "auto",
  baseUrl: "https://api.example.com",
  channelId: CHANNEL,
  userId: null,
  textMode: "stream",
  auth: "api_key",
  hasApiKey: true,
  apiKeyHint: "••••1234",
});

async function openCreate() {
  const user = userEvent.setup();
  renderWithClient(<AgentsContainer />);
  await user.click(await screen.findByRole("button", { name: "Add agent" }));
  const dialog = await screen.findByRole("dialog", { name: "Add agent" });
  await within(dialog).findByLabelText("Name");
  return { user, dialog };
}

async function openChatAgent() {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/agents?agent=a-chat");
  renderWithClient(<AgentsContainer />);
  await screen.findByRole("heading", { level: 1, name: "Chat desk" });
  const form = await screen.findByRole("form", { name: "Agent settings" });
  return { user, form };
}

const saveChanges = () => screen.getByRole("button", { name: "Save changes" });

describe("Text agents: create", () => {
  it("creates a text agent with an API key and sends only the text fields", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([]);
    const { user, dialog } = await openCreate();

    await user.click(within(dialog).getByRole("radio", { name: "Text" }));
    expect(within(dialog).queryByLabelText("User ID")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Protocol")).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Name"), "Chat desk");
    await user.type(within(dialog).getByLabelText("Base URL"), "https://api.example.com");
    await user.type(within(dialog).getByLabelText("Channel ID"), CHANNEL);
    expect(within(dialog).getByRole("radio", { name: "Stream" })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: "Invoke" }));
    await user.click(within(dialog).getByRole("radio", { name: "API key" }));
    await user.type(within(dialog).getByLabelText("API key value"), "sk-test-1234");
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests).toEqual([
      {
        method: "POST",
        path: "/agents",
        body: {
          name: "Chat desk",
          context: "",
          kind: "text",
          baseUrl: "https://api.example.com",
          channelId: CHANNEL,
          textMode: "invoke",
          auth: "api_key",
          apiKey: "sk-test-1234",
          origin: null,
          langfuseConnectionId: null,
        },
      },
    ]);
  });

  it("asks for the API key and a UUID channel before creating", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([]);
    const { user, dialog } = await openCreate();

    await user.click(within(dialog).getByRole("radio", { name: "Text" }));
    await user.type(within(dialog).getByLabelText("Name"), "Chat desk");
    await user.type(within(dialog).getByLabelText("Base URL"), "wss://api.example.com");
    await user.type(within(dialog).getByLabelText("Channel ID"), "hotel-dev");
    await user.click(within(dialog).getByRole("radio", { name: "API key" }));
    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));

    expect(await within(dialog).findByText("URL must use https://.")).toBeInTheDocument();
    expect(within(dialog).getByText("Use the channel's UUID.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter the API key.")).toBeInTheDocument();
    expect(api.requests).toEqual([]);
  });

  it("imports a text cURL: switches to Text and prefills mode, auth, key and origin", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([]);
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Chat desk");
    await user.click(within(dialog).getByRole("button", { name: "Import from cURL" }));
    await user.paste(
      `curl 'https://api.example.com/channelsApi/${CHANNEL}/invoke' -H 'vivi-api-key: sk-imported-77' -H 'origin: https://portal.example.com' --data-raw '{"message":"hi"}'`,
    );
    await user.click(within(dialog).getByRole("button", { name: "Import" }));

    expect(within(dialog).getByRole("radio", { name: "Text" })).toBeChecked();
    expect(within(dialog).getByLabelText("Base URL")).toHaveValue("https://api.example.com");
    expect(within(dialog).getByLabelText("Channel ID")).toHaveValue(CHANNEL);
    expect(within(dialog).getByRole("radio", { name: "Invoke" })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "API key" })).toBeChecked();
    expect(within(dialog).getByLabelText("API key value")).toHaveValue("sk-imported-77");
    const summary = within(dialog).getByRole("status");
    expect(summary).toHaveTextContent("Filled: kind (text), base URL, channel ID, mode, authentication, API key, origin.");
    expect(summary).not.toHaveTextContent("sk-imported-77");

    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toMatchObject({ kind: "text", apiKey: "sk-imported-77", origin: "https://portal.example.com" });
  });
});

describe("Text agents: detail", () => {
  it("shows the fixed kind, the chat connection and the saved key without revealing it", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([chatAgent]);
    const { form } = await openChatAgent();

    expect(screen.queryByRole("radio", { name: "Voice" })).not.toBeInTheDocument();
    const chat = within(form).getByRole("region", { name: "Chat connection" });
    expect(within(chat).getByText("Text agent")).toBeInTheDocument();
    expect(within(chat).getByLabelText("Base URL")).toHaveValue("https://api.example.com");
    expect(within(chat).getByLabelText("Channel ID")).toHaveValue(CHANNEL);
    expect(within(chat).getByRole("radio", { name: "Stream" })).toBeChecked();
    expect(within(chat).getByText("Saved ••••1234")).toBeInTheDocument();
    expect(within(chat).queryByLabelText("API key value")).not.toBeInTheDocument();
    expect(within(chat).getByText(/sends one short message to the agent/)).toBeInTheDocument();
  });

  it("replaces the stored key with a new one", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([chatAgent]);
    const { user, form } = await openChatAgent();

    await user.click(within(form).getByRole("button", { name: "Replace" }));
    await user.type(within(form).getByLabelText("API key value"), "sk-new-5678");
    await user.click(saveChanges());

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0]).toEqual({ method: "PATCH", path: "/agents/a-chat", body: { apiKey: "sk-new-5678" } });
  });

  it("removes the stored key by switching authentication off", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([chatAgent]);
    const { user, form } = await openChatAgent();

    await user.click(within(form).getByRole("button", { name: "Remove" }));
    expect(within(form).getByRole("radio", { name: "None" })).toBeChecked();
    await user.click(saveChanges());

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0]).toEqual({ method: "PATCH", path: "/agents/a-chat", body: { auth: "none" } });
  });

  it("runs the text connection test", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([chatAgent], {
      connectionTest: () =>
        connectionTestFixture({ protocol: null, latencyMs: 820, log: [{ ok: true, message: "The agent replied in 820 ms" }] }),
    });
    const { user, form } = await openChatAgent();

    await user.click(within(form).getByRole("button", { name: "Run connection test" }));

    expect(await within(form).findByText("Reachable · 820 ms")).toBeInTheDocument();
    expect(api.requests).toEqual([{ method: "POST", path: "/agents/a-chat/test", body: undefined }]);
  });

  it("does not import a voice cURL into a text agent", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([chatAgent]);
    const { user, form } = await openChatAgent();

    await user.click(within(form).getByRole("button", { name: "Import from cURL" }));
    await user.paste("curl 'wss://a.example.com/channelApi/c/realtime?userId=u'");
    await user.click(within(form).getByRole("button", { name: "Import" }));

    expect(within(form).getByRole("status")).toHaveTextContent(
      "This command is for a voice agent; this agent is a text agent. Nothing filled.",
    );
    expect(within(form).getByLabelText("Base URL")).toHaveValue("https://api.example.com");
  });

  it("names the kind and mode in the rail", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([agentFixture(), chatAgent]);
    await openChatAgent();

    const rail = screen.getByRole("complementary", { name: "Agents" });
    expect(within(rail).getByRole("button", { name: /Chat desk/ })).toHaveTextContent("Text");
    expect(within(rail).getByRole("button", { name: /Chat desk/ })).toHaveTextContent("Stream");
    expect(within(rail).getByRole("button", { name: /Hotel booking assistant/ })).toHaveTextContent("Voice");
  });
});
