import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { ConnectionsContainer } from "./ConnectionsContainer";
import { connectionFixture, mockConnectionsApi } from "./testing";

const passed = { at: "2026-10-08T09:00:00Z", ok: true, detail: "HTTP 200: credentials accepted" };
const failed = { at: "2026-10-08T09:00:00Z", ok: false, detail: "HTTP 401: credentials rejected" };

async function findRow(name: string) {
  return screen.findByRole("row", { name: new RegExp(name) });
}

describe("Connections list", () => {
  it("shows each connection with its provider, key hint and last test status", async () => {
    mockConnectionsApi([
      connectionFixture({ lastTest: passed }),
      connectionFixture({
        id: "c-speech",
        name: "Speech EU",
        kind: "azure_speech",
        config: { region: "westeurope", endpoint: null, voice: null },
        secretHint: "••••",
        lastTest: failed,
      }),
      connectionFixture({ id: "c-lf", name: "Traces", kind: "langfuse", secretHint: "••••9f2e" }),
    ]);
    renderWithClient(<ConnectionsContainer />);

    const openai = await findRow("OpenAI prod");
    expect(within(openai).getByText("OpenAI")).toBeInTheDocument();
    expect(within(openai).getByText("••••3a1c")).toBeInTheDocument();
    expect(within(openai).getByText("Passed")).toBeInTheDocument();
    expect(within(openai).getByText("HTTP 200: credentials accepted")).toBeInTheDocument();

    const speech = await findRow("Speech EU");
    expect(within(speech).getByText("Azure AI Speech")).toBeInTheDocument();
    expect(within(speech).getByText("Failed")).toBeInTheDocument();
    expect(within(speech).getByText("HTTP 401: credentials rejected")).toBeInTheDocument();

    const traces = await findRow("Traces");
    expect(within(traces).getByText("Langfuse")).toBeInTheDocument();
    expect(within(traces).getByText("Not tested")).toBeInTheDocument();
    expect(within(traces).getByRole("button", { name: "Edit Traces" })).toBeInTheDocument();
    expect(within(traces).getByRole("button", { name: "Test Traces" })).toBeInTheDocument();
    expect(within(traces).getByRole("button", { name: "Delete Traces" })).toBeInTheDocument();
  });

  it("shows an empty state whose call to action opens the create dialog", async () => {
    mockConnectionsApi([]);
    renderWithClient(<ConnectionsContainer />);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "No connections yet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add your first connection" }));

    expect(screen.getByRole("dialog", { name: "Add connection" })).toBeInTheDocument();
  });

  it("shows an error with a retry when the list cannot be loaded", async () => {
    let calls = 0;
    server.use(
      http.get(apiUrl("/connections"), () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ detail: "Database unavailable" }, { status: 503 })
          : HttpResponse.json([connectionFixture()]);
      }),
    );
    renderWithClient(<ConnectionsContainer />);
    const user = userEvent.setup();

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load connections");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await findRow("OpenAI prod")).toBeInTheDocument();
  });

  it("tests a stored connection from its row and shows the new status", async () => {
    const api = mockConnectionsApi([connectionFixture({ lastTest: passed })], { storedResult: failed });
    renderWithClient(<ConnectionsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("OpenAI prod")).getByRole("button", { name: "Test OpenAI prod" }));

    await waitFor(() => expect(within(screen.getByRole("row", { name: /OpenAI prod/ })).getByText("Failed")).toBeInTheDocument());
    expect(screen.getByText("HTTP 401: credentials rejected")).toBeInTheDocument();
    expect(api.requests).toEqual([{ method: "POST", path: "/connections/c-openai/test", body: undefined }]);
  });

  it("reports a stored test that the server cannot run", async () => {
    mockConnectionsApi([connectionFixture()]);
    server.use(
      http.post(apiUrl("/connections/:id/test"), () =>
        HttpResponse.json({ detail: "Stored secret cannot be decrypted" }, { status: 500 }),
      ),
    );
    renderWithClient(<ConnectionsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("OpenAI prod")).getByRole("button", { name: "Test OpenAI prod" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not test OpenAI prod: Stored secret cannot be decrypted",
    );
  });

  it("deletes only after the user confirms in a dialog naming the connection", async () => {
    const api = mockConnectionsApi([connectionFixture(), connectionFixture({ id: "c-2", name: "Backup" })]);
    renderWithClient(<ConnectionsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("OpenAI prod")).getByRole("button", { name: "Delete OpenAI prod" }));
    let dialog = screen.getByRole("dialog", { name: "Delete “OpenAI prod”?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.requests).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Delete OpenAI prod" }));
    dialog = screen.getByRole("dialog", { name: "Delete “OpenAI prod”?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete connection" }));

    await waitFor(() => expect(screen.queryByRole("row", { name: /OpenAI prod/ })).not.toBeInTheDocument());
    expect(api.requests).toEqual([{ method: "DELETE", path: "/connections/c-openai", body: undefined }]);
    expect(screen.getByRole("row", { name: /Backup/ })).toBeInTheDocument();
  });
});
