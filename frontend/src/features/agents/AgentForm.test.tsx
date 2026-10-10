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

async function openEdit(name = "Hotel booking assistant") {
  const user = userEvent.setup();
  renderWithClient(<AgentsContainer />);
  await user.click(await screen.findByRole("button", { name: `Edit ${name}` }));
  const dialog = await screen.findByRole("dialog", { name: `Edit ${name}` });
  await within(dialog).findByLabelText("Name");
  return { user, dialog };
}

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
    expect(await screen.findByRole("row", { name: /Hotel desk/ })).toBeInTheDocument();
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
    await user.clear(within(dialog).getByLabelText("Origin (optional)"));
    await user.selectOptions(within(dialog).getByLabelText("Langfuse connection"), "None");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests).toEqual([
      {
        method: "PATCH",
        path: "/agents/a-hotel",
        body: { channelId: "hotel-prod", origin: null, langfuseConnectionId: null },
      },
    ]);
  });

  it("closes without a request when nothing changed", async () => {
    mockConnectionsApi([]);
    const api = mockAgentsApi([agentFixture()]);
    const { user, dialog } = await openEdit();

    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests).toEqual([]);
  });
});
