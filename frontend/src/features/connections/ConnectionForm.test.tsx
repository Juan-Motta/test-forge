import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { ConnectionsContainer } from "./ConnectionsContainer";
import { connectionFixture, mockConnectionsApi } from "./testing";

const CANARY = "sk-canary-0123456789-zz9q";

async function openCreate() {
  const user = userEvent.setup();
  renderWithClient(<ConnectionsContainer />);
  await screen.findByRole("heading", { name: "Connections" });
  await user.click(await screen.findByRole("button", { name: "Add connection" }));
  return { user, dialog: screen.getByRole("dialog", { name: "Add connection" }) };
}

async function openEdit(name = "OpenAI prod") {
  const user = userEvent.setup();
  renderWithClient(<ConnectionsContainer />);
  await user.click(await screen.findByRole("button", { name: `Edit ${name}` }));
  return { user, dialog: screen.getByRole("dialog", { name: `Edit ${name}` }) };
}

describe("Create connection", () => {
  it("creates an OpenAI connection with the camelCase payload, refreshes the list and never shows the key", async () => {
    const api = mockConnectionsApi([]);
    const { user, dialog } = await openCreate();

    expect(within(dialog).getByLabelText("Provider")).toHaveValue("openai");
    await user.type(within(dialog).getByLabelText("Name"), "Main OpenAI");
    await user.clear(within(dialog).getByLabelText("TTS voice"));
    await user.type(within(dialog).getByLabelText("TTS voice"), "coral");
    await user.type(within(dialog).getByLabelText("API key"), CANARY);
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests).toEqual([
      {
        method: "POST",
        path: "/connections",
        body: {
          name: "Main OpenAI",
          kind: "openai",
          config: {
            baseUrl: "https://api.openai.com/v1",
            ttsModel: "gpt-4o-mini-tts",
            ttsVoice: "coral",
            chatModel: "gpt-4.1-mini",
          },
          secrets: { apiKey: CANARY },
        },
      },
    ]);
    const row = await screen.findByRole("row", { name: /Main OpenAI/ });
    expect(within(row).getByText("••••zz9q")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(CANARY);
  });

  it.each([
    {
      kind: "azure_openai",
      fill: {
        Endpoint: "https://res.openai.azure.com",
        "API version": "2025-03-01-preview",
        "TTS deployment": "my-tts",
        "Chat deployment": "my-chat",
        "API key": "azure-openai-key-123",
      },
      config: {
        endpoint: "https://res.openai.azure.com",
        apiVersion: "2025-03-01-preview",
        ttsDeployment: "my-tts",
        ttsVoice: "alloy",
        chatDeployment: "my-chat",
      },
      secrets: { apiKey: "azure-openai-key-123" },
    },
    {
      kind: "azure_speech",
      fill: { Region: "eastus", Voice: "es-MX-DaliaNeural", Key: "speech-key-123456" },
      config: { region: "eastus", voice: "es-MX-DaliaNeural" },
      secrets: { key: "speech-key-123456" },
    },
    {
      kind: "langfuse",
      fill: { Host: "https://cloud.langfuse.com", "Public key": "pk-lf-123", "Secret key": "sk-lf-456" },
      config: { host: "https://cloud.langfuse.com", publicKey: "pk-lf-123" },
      secrets: { secretKey: "sk-lf-456" },
    },
  ])("creates a $kind connection with its own fields", async ({ kind, fill, config, secrets }) => {
    const api = mockConnectionsApi([]);
    const { user, dialog } = await openCreate();

    await user.selectOptions(within(dialog).getByLabelText("Provider"), kind);
    await user.type(within(dialog).getByLabelText("Name"), `My ${kind}`);
    for (const [label, value] of Object.entries(fill)) {
      await user.type(within(dialog).getByLabelText(label), value);
    }
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toEqual({ name: `My ${kind}`, kind, config, secrets });
  });

  it("blocks a non-https URL before calling the backend", async () => {
    const api = mockConnectionsApi([]);
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Proxy");
    await user.clear(within(dialog).getByLabelText("Base URL"));
    await user.type(within(dialog).getByLabelText("Base URL"), "http://api.example.com/v1");
    await user.type(within(dialog).getByLabelText("API key"), CANARY);
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));

    expect(await within(dialog).findByLabelText("Base URL")).toHaveAccessibleDescription(
      expect.stringContaining("URL must use https"),
    );
    expect(api.requests).toEqual([]);
  });

  it("blocks a malformed region and requires exactly one of region or endpoint", async () => {
    const api = mockConnectionsApi([]);
    const { user, dialog } = await openCreate();

    await user.selectOptions(within(dialog).getByLabelText("Provider"), "azure_speech");
    await user.type(within(dialog).getByLabelText("Name"), "Speech");
    await user.type(within(dialog).getByLabelText("Key"), "speech-key-123456");
    await user.type(within(dialog).getByLabelText("Region"), "East US");
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));

    expect(await within(dialog).findByLabelText("Region")).toHaveAccessibleDescription(
      expect.stringContaining("lowercase letters and digits"),
    );

    await user.clear(within(dialog).getByLabelText("Region"));
    await user.type(within(dialog).getByLabelText("Region"), "eastus");
    await user.type(within(dialog).getByLabelText("Endpoint"), "https://eastus.api.cognitive.microsoft.com");
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));

    await waitFor(() =>
      expect(within(dialog).getByLabelText("Endpoint")).toHaveAccessibleDescription(
        expect.stringContaining("not both"),
      ),
    );
    expect(api.requests).toEqual([]);
  });

  it("shows a duplicate name (409) on the name field", async () => {
    mockConnectionsApi([]);
    server.use(
      http.post(apiUrl("/connections"), () =>
        HttpResponse.json({ detail: "Connection name already in use" }, { status: 409 }),
      ),
    );
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Taken");
    await user.type(within(dialog).getByLabelText("API key"), CANARY);
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));

    await waitFor(() =>
      expect(within(dialog).getByLabelText("Name")).toHaveAccessibleDescription(
        expect.stringContaining("A connection with this name already exists."),
      ),
    );
  });

  it("puts server validation errors (422) on the matching fields and the rest in an alert", async () => {
    mockConnectionsApi([]);
    server.use(
      http.post(apiUrl("/connections"), () =>
        HttpResponse.json(
          {
            detail: [
              { loc: ["body", "config", "baseUrl"], msg: "URL must not contain a query string or fragment" },
              { loc: ["body", "secrets", "apiKey"], msg: "String should have at most 4096 characters" },
              { loc: ["body", "config"], msg: "Value error, something about the whole config" },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Main");
    await user.type(within(dialog).getByLabelText("API key"), CANARY);
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));

    await waitFor(() =>
      expect(within(dialog).getByLabelText("Base URL")).toHaveAccessibleDescription(
        expect.stringContaining("URL must not contain a query string or fragment"),
      ),
    );
    expect(within(dialog).getByLabelText("API key")).toHaveAccessibleDescription(
      expect.stringContaining("String should have at most 4096 characters"),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Value error, something about the whole config");
  });

  it("sends a single request when Create is clicked repeatedly", async () => {
    const api = mockConnectionsApi([]);
    let release: () => void = () => {};
    let posts = 0;
    server.use(
      http.post(apiUrl("/connections"), async () => {
        posts += 1;
        await new Promise<void>((resolve) => (release = resolve));
        return HttpResponse.json(connectionFixture({ name: "Once" }), { status: 201 });
      }),
    );
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Once");
    await user.type(within(dialog).getByLabelText("API key"), CANARY);
    const submit = within(dialog).getByRole("button", { name: "Create connection" });
    // Two synchronous clicks: the second lands before React re-renders the disabled button.
    fireEvent.click(submit);
    fireEvent.click(submit);

    expect(await within(dialog).findByRole("button", { name: "Saving…" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(posts).toBe(1);
    expect(api.requests).toEqual([]);
  });

  it("tests the draft with the current values and shows the result inline", async () => {
    const api = mockConnectionsApi([], {
      draftResult: { at: "2026-10-09T10:00:00Z", ok: false, detail: "HTTP 401: credentials rejected" },
    });
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("API key"), CANARY);
    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

    expect(await within(dialog).findByText("HTTP 401: credentials rejected")).toBeInTheDocument();
    expect(within(dialog).getByText("Test failed")).toBeInTheDocument();
    expect(api.requests).toEqual([
      {
        method: "POST",
        path: "/connections/test",
        body: {
          kind: "openai",
          config: {
            baseUrl: "https://api.openai.com/v1",
            ttsModel: "gpt-4o-mini-tts",
            ttsVoice: "alloy",
            chatModel: "gpt-4.1-mini",
          },
          secrets: { apiKey: CANARY },
        },
      },
    ]);
  });
});

describe("Edit connection", () => {
  it("never pre-fills the secret, keeps the kind fixed and omits secrets when none was typed", async () => {
    const api = mockConnectionsApi([connectionFixture()]);
    const { user, dialog } = await openEdit();

    const key = within(dialog).getByLabelText("API key");
    expect(key).toHaveValue("");
    expect(key).toHaveAccessibleDescription(expect.stringContaining("Stored key ••••3a1c — leave blank to keep it"));
    expect(within(dialog).queryByRole("combobox", { name: "Provider" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("OpenAI")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveValue("OpenAI prod");

    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "OpenAI main");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0]).toEqual({ method: "PATCH", path: "/connections/c-openai", body: { name: "OpenAI main" } });
    expect(await screen.findByRole("row", { name: /OpenAI main/ })).toBeInTheDocument();
  });

  it("sends a newly typed secret and the changed config, and never shows the secret afterwards", async () => {
    const api = mockConnectionsApi([connectionFixture()]);
    const { user, dialog } = await openEdit();

    await user.clear(within(dialog).getByLabelText("TTS voice"));
    await user.type(within(dialog).getByLabelText("TTS voice"), "verse");
    await user.type(within(dialog).getByLabelText("API key"), CANARY);
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests[0].body).toEqual({
      config: { baseUrl: "https://api.openai.com/v1", ttsModel: "gpt-4o-mini-tts", ttsVoice: "verse" },
      secrets: { apiKey: CANARY },
    });
    expect(await screen.findByText("••••zz9q")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(CANARY);
  });

  it("tests the stored connection when the secret is left blank, and says so", async () => {
    const api = mockConnectionsApi([connectionFixture()]);
    const { user, dialog } = await openEdit();

    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

    expect(await within(dialog).findByText("Test passed")).toBeInTheDocument();
    expect(within(dialog).getByText(/Tested the saved connection/)).toBeInTheDocument();
    expect(api.requests).toEqual([{ method: "POST", path: "/connections/c-openai/test", body: undefined }]);
  });

  it("tests the draft when a new secret was typed", async () => {
    const api = mockConnectionsApi([connectionFixture()]);
    const { user, dialog } = await openEdit();

    await user.type(within(dialog).getByLabelText("API key"), CANARY);
    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

    expect(await within(dialog).findByText("Test passed")).toBeInTheDocument();
    expect(api.requests).toEqual([
      {
        method: "POST",
        path: "/connections/test",
        body: {
          kind: "openai",
          config: { baseUrl: "https://api.openai.com/v1", ttsModel: "gpt-4o-mini-tts", ttsVoice: "alloy" },
          secrets: { apiKey: CANARY },
        },
      },
    ]);
  });
});

describe("Form edge cases", () => {
  it("treats a whitespace-only secret as missing on create and sends nothing", async () => {
    const api = mockConnectionsApi([]);
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Blank key");
    await user.type(within(dialog).getByLabelText("API key"), "   ");
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));

    await waitFor(() =>
      expect(within(dialog).getByLabelText("API key")).toHaveAccessibleDescription(
        expect.stringContaining("Enter the API key."),
      ),
    );
    expect(api.requests).toEqual([]);
  });

  it("keeps the stored secret on edit when only whitespace was typed", async () => {
    const api = mockConnectionsApi([connectionFixture()]);
    const { user, dialog } = await openEdit();

    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "OpenAI main");
    await user.type(within(dialog).getByLabelText("API key"), "  ");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0]).toEqual({ method: "PATCH", path: "/connections/c-openai", body: { name: "OpenAI main" } });
  });

  it("rejects a secret with surrounding spaces instead of silently trimming it", async () => {
    const api = mockConnectionsApi([]);
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Padded");
    await user.type(within(dialog).getByLabelText("API key"), ` ${CANARY} `);
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));

    await waitFor(() =>
      expect(within(dialog).getByLabelText("API key")).toHaveAccessibleDescription(
        expect.stringContaining("must not start or end with spaces"),
      ),
    );
    expect(api.requests).toEqual([]);
  });

  it("edits the evaluator chat model of a connection stored before it existed", async () => {
    const api = mockConnectionsApi([connectionFixture()]);
    const { user, dialog } = await openEdit();

    const chatModel = within(dialog).getByLabelText("Chat model");
    expect(chatModel).toHaveValue("");
    expect(chatModel).toHaveAccessibleDescription(expect.stringContaining("evaluator"));
    await user.type(chatModel, "gpt-4.1");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0].body).toEqual({
      config: {
        baseUrl: "https://api.openai.com/v1",
        ttsModel: "gpt-4o-mini-tts",
        ttsVoice: "alloy",
        chatModel: "gpt-4.1",
      },
    });
  });

  it("blocks a chat deployment that is not an identifier", async () => {
    const api = mockConnectionsApi([]);
    const { user, dialog } = await openCreate();

    await user.selectOptions(within(dialog).getByLabelText("Provider"), "azure_openai");
    await user.type(within(dialog).getByLabelText("Chat deployment"), "my chat");
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));

    await waitFor(() =>
      expect(within(dialog).getByLabelText("Chat deployment")).toHaveAccessibleDescription(
        expect.stringContaining("Use only letters"),
      ),
    );
    expect(api.requests).toEqual([]);
  });

  it("closes without a request when an edit changes nothing", async () => {
    const api = mockConnectionsApi([connectionFixture()]);
    const { user, dialog } = await openEdit();

    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests).toEqual([]);
  });

  it("shows field errors and sends nothing when a draft test fails local validation", async () => {
    const api = mockConnectionsApi([]);
    const { user, dialog } = await openCreate();

    await user.clear(within(dialog).getByLabelText("Base URL"));
    await user.type(within(dialog).getByLabelText("Base URL"), "http://api.example.com/v1");
    await user.click(within(dialog).getByRole("button", { name: "Test connection" }));

    expect(within(dialog).getByLabelText("Base URL")).toHaveAccessibleDescription(
      expect.stringContaining("URL must use https."),
    );
    expect(within(dialog).getByLabelText("API key")).toHaveAccessibleDescription(
      expect.stringContaining("Enter the API key."),
    );
    expect(api.requests).toEqual([]);
  });

  it("clears a field's server error as soon as the user edits that field", async () => {
    mockConnectionsApi([]);
    server.use(
      http.post(apiUrl("/connections"), () =>
        HttpResponse.json(
          {
            detail: [
              { type: "value_error", loc: ["body", "config", "baseUrl"], msg: "Server says the URL is wrong" },
              { type: "value_error", loc: ["body", "secrets", "apiKey"], msg: "Server says the key is wrong" },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    const { user, dialog } = await openCreate();

    await user.type(within(dialog).getByLabelText("Name"), "Main");
    await user.type(within(dialog).getByLabelText("API key"), CANARY);
    await user.click(within(dialog).getByRole("button", { name: "Create connection" }));
    const baseUrl = within(dialog).getByLabelText("Base URL");
    await waitFor(() =>
      expect(baseUrl).toHaveAccessibleDescription(expect.stringContaining("Server says the URL is wrong")),
    );

    await user.type(baseUrl, "/v2");

    expect(baseUrl).not.toHaveAccessibleDescription(expect.stringContaining("Server says the URL is wrong"));
    expect(baseUrl).not.toHaveAttribute("aria-invalid");
    // Fields the user has not touched keep their server error.
    expect(within(dialog).getByLabelText("API key")).toHaveAccessibleDescription(
      expect.stringContaining("Server says the key is wrong"),
    );
  });
});

