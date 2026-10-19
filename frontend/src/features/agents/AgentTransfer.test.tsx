import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { connectionFixture, mockConnectionsApi } from "@/features/connections/testing";
import { renderWithClient } from "@/test/render";
import { AgentsContainer } from "./AgentsContainer";
import { agentFixture, mockAgentsApi } from "./testing";

const traces = connectionFixture({ id: "c-lf", name: "Traces", kind: "langfuse", config: { host: "https://cloud.langfuse.com" } });
const chat = agentFixture({
  id: "a-chat",
  name: "Chat desk",
  kind: "text",
  protocol: "auto",
  baseUrl: "https://chat.example.com/api",
  userId: null,
  textMode: "invoke",
  auth: "api_key",
  hasApiKey: true,
  apiKeyHint: "••••9xq2",
  langfuseConnectionId: "c-lf",
});

afterEach(() => window.history.replaceState(null, "", "/"));

async function openImport() {
  const user = userEvent.setup();
  renderWithClient(<AgentsContainer />);
  await screen.findByRole("heading", { level: 1 });
  await user.click(await screen.findByRole("button", { name: "Import" }));
  const dialog = await screen.findByRole("dialog", { name: "Add agent" });
  const panel = within(dialog).getByRole("group", { name: "Import an agent config" });
  return { user, dialog, panel };
}

describe("Agent export", () => {
  it("shows the agent as text with its Langfuse connection by name and never its API key", async () => {
    mockConnectionsApi([traces]);
    mockAgentsApi([chat]);
    const user = userEvent.setup();
    renderWithClient(<AgentsContainer />);

    await screen.findByRole("heading", { level: 1, name: "Chat desk" });
    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("dialog", { name: "Export Chat desk" });
    const text = (within(dialog).getByLabelText("Exported config") as HTMLTextAreaElement).value;

    expect(JSON.parse(text)).toEqual({
      duet: "agent",
      version: 1,
      kind: "text",
      name: "Chat desk",
      context: chat.context,
      baseUrl: "https://chat.example.com/api",
      channelId: "hotel-dev",
      textMode: "invoke",
      auth: "api_key",
      origin: null,
      langfuseConnection: "Traces",
    });
    expect(text).not.toContain("9xq2");
    expect(within(dialog).getByRole("button", { name: "Download .json" })).toBeInTheDocument();
  });
});

describe("Agent import", () => {
  it("prefills the new agent from an exported config, notes what needs the user, and creates it on save", async () => {
    mockConnectionsApi([traces]);
    const api = mockAgentsApi([]);
    const { user, dialog, panel } = await openImport();
    const exported = {
      duet: "agent",
      version: 1,
      kind: "text",
      name: "Chat desk",
      context: "A support chat.",
      baseUrl: "https://chat.example.com/api",
      channelId: "3f6c1a2e-8b4d-4c1f-9a7e-2d5b6c7e8f90",
      textMode: "stream",
      auth: "none",
      origin: null,
      langfuseConnection: "Production traces",
    };

    await user.click(within(panel).getByLabelText("Exported config"));
    await user.paste(JSON.stringify(exported));
    await user.click(within(panel).getByRole("button", { name: "Import" }));

    expect(within(dialog).queryByRole("group", { name: "Import an agent config" })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/The form was filled from the imported config/)).toBeInTheDocument();
    expect(within(dialog).getByText("No connection is named “Production traces” here: pick one.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Chat desk");
    expect(api.requests).toEqual([]);

    await user.click(within(dialog).getByRole("button", { name: "Create agent" }));
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toMatchObject({
      kind: "text",
      name: "Chat desk",
      baseUrl: "https://chat.example.com/api",
      channelId: "3f6c1a2e-8b4d-4c1f-9a7e-2d5b6c7e8f90",
      textMode: "stream",
      auth: "none",
      langfuseConnectionId: null,
    });
  });

  it("matches the Langfuse connection by name and asks for the API key again", async () => {
    mockConnectionsApi([traces]);
    mockAgentsApi([]);
    const { user, dialog, panel } = await openImport();

    await user.click(within(panel).getByLabelText("Exported config"));
    await user.paste(
      JSON.stringify({ duet: "agent", version: 1, kind: "text", name: "Keyed", baseUrl: "https://k.example.com", channelId: "k", auth: "api_key", langfuseConnection: "traces" }),
    );
    await user.click(within(panel).getByRole("button", { name: "Import" }));

    expect(within(dialog).getByText("The API key is never exported: enter it again.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/No connection is named/)).not.toBeInTheDocument();
  });

  it("refuses text that is not an exported agent and keeps the panel open", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([]);
    const { user, panel } = await openImport();
    const field = within(panel).getByLabelText("Exported config");

    await user.click(field);
    await user.paste("not json");
    await user.click(within(panel).getByRole("button", { name: "Import" }));
    expect(field).toHaveAccessibleDescription(expect.stringContaining("This is not an exported config"));

    await user.clear(field);
    await user.paste(JSON.stringify({ duet: "scenario", version: 1, name: "x" }));
    await user.click(within(panel).getByRole("button", { name: "Import" }));
    expect(field).toHaveAccessibleDescription(expect.stringContaining("This config is not an agent."));

    await user.clear(field);
    await user.paste(JSON.stringify({ duet: "agent", version: 2 }));
    await user.click(within(panel).getByRole("button", { name: "Import" }));
    expect(field).toHaveAccessibleDescription(expect.stringContaining("newer or unknown version"));
  });

  it("reads an exported agent from a .json file", async () => {
    mockConnectionsApi([]);
    mockAgentsApi([]);
    const { user, dialog, panel } = await openImport();
    const file = new File(
      [JSON.stringify({ duet: "agent", version: 1, kind: "voice", name: "From file", baseUrl: "wss://f.example.com/ws", channelId: "f", userId: "u", protocol: "live" })],
      "from-file.agent.json",
      { type: "application/json" },
    );

    await user.upload(within(panel).getByLabelText(/Or pick a file/), file);
    await waitFor(() => expect(within(dialog).getByLabelText("Name")).toHaveValue("From file"));
  });
});
