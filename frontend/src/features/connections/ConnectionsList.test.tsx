import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { ConnectionsContainer } from "./ConnectionsContainer";
import { connectionFixture, mockConnectionsApi } from "./testing";

const passed = { at: "2026-10-08T09:00:00Z", ok: true, detail: "HTTP 200: credentials accepted" };
const failed = { at: "2026-10-08T09:00:00Z", ok: false, detail: "HTTP 401: credentials rejected" };

/** Each connection is a card (`article`) named by its heading. */
async function findRow(name: string) {
  return screen.findByRole("article", { name: new RegExp(name) });
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

    await waitFor(() => expect(within(screen.getByRole("article", { name: /OpenAI prod/ })).getByText("Failed")).toBeInTheDocument());
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

    await waitFor(() => expect(screen.queryByRole("article", { name: /OpenAI prod/ })).not.toBeInTheDocument());
    expect(api.requests).toEqual([{ method: "DELETE", path: "/connections/c-openai", body: undefined }]);
    expect(screen.getByRole("article", { name: /Backup/ })).toBeInTheDocument();
  });

  it("lists each connection as a card named by the connection, with where it points", async () => {
    mockConnectionsApi([
      connectionFixture(),
      connectionFixture({
        id: "c-lf",
        name: "Traces",
        kind: "langfuse",
        config: { host: "https://cloud.langfuse.com", publicKey: "pk-lf-1" },
      }),
      connectionFixture({
        id: "c-speech",
        name: "Speech EU",
        kind: "azure_speech",
        config: { region: "westeurope", endpoint: null, voice: null },
      }),
    ]);
    renderWithClient(<ConnectionsContainer />);

    const list = await screen.findByRole("list", { name: "Provider connections" });
    const cards = within(list).getAllByRole("article");
    expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual([
      "OpenAI prod",
      "Traces",
      "Speech EU",
    ]);
    expect(within(cards[0]).getByText("https://api.openai.com/v1")).toBeInTheDocument();
    expect(within(cards[1]).getByText("https://cloud.langfuse.com")).toBeInTheDocument();
    expect(within(cards[2]).getByText("westeurope")).toBeInTheDocument();
  });

  it("shows every row being tested while two tests run at once", async () => {
    mockConnectionsApi([connectionFixture(), connectionFixture({ id: "c-2", name: "Backup" })]);
    const releases: Array<() => void> = [];
    server.use(
      http.post(apiUrl("/connections/:id/test"), async () => {
        await new Promise<void>((resolve) => releases.push(resolve));
        return HttpResponse.json(passed);
      }),
    );
    renderWithClient(<ConnectionsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("OpenAI prod")).getByRole("button", { name: "Test OpenAI prod" }));
    await user.click(within(await findRow("Backup")).getByRole("button", { name: "Test Backup" }));

    expect(await screen.findByRole("button", { name: "Testing OpenAI prod" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Testing Backup" })).toBeDisabled();
    await waitFor(() => expect(releases).toHaveLength(2));

    releases[0]();
    await waitFor(() => expect(screen.getByRole("button", { name: "Test OpenAI prod" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Testing Backup" })).toBeDisabled();
    releases[1]();
    await waitFor(() => expect(screen.getByRole("button", { name: "Test Backup" })).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent("Backup: test passed.");
  });

  it("sends a single delete when Delete connection is clicked repeatedly", async () => {
    mockConnectionsApi([connectionFixture(), connectionFixture({ id: "c-2", name: "Backup" })]);
    let release: () => void = () => {};
    let deletes = 0;
    server.use(
      http.delete(apiUrl("/connections/:id"), async () => {
        deletes += 1;
        await new Promise<void>((resolve) => (release = resolve));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithClient(<ConnectionsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("OpenAI prod")).getByRole("button", { name: "Delete OpenAI prod" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Delete connection" });
    // Two synchronous clicks: the second lands before React re-renders the disabled button.
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(await screen.findByRole("button", { name: "Deleting…" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deletes).toBe(1);
  });

  it("keeps the dialog open with the reason when a delete fails, and clears it when reopened", async () => {
    mockConnectionsApi([connectionFixture()]);
    server.use(
      http.delete(apiUrl("/connections/:id"), () =>
        HttpResponse.json({ detail: "Database unavailable" }, { status: 503 }),
      ),
    );
    renderWithClient(<ConnectionsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("OpenAI prod")).getByRole("button", { name: "Delete OpenAI prod" }));
    let dialog = screen.getByRole("dialog", { name: "Delete “OpenAI prod”?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete connection" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Database unavailable");
    expect(within(dialog).getByRole("button", { name: "Delete connection" })).toBeEnabled();
    expect(screen.getByRole("article", { name: /OpenAI prod/ })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Delete OpenAI prod" }));
    dialog = screen.getByRole("dialog", { name: "Delete “OpenAI prod”?" });
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still deletes another connection after cancelling a dialog whose delete was in flight", async () => {
    const api = mockConnectionsApi([connectionFixture(), connectionFixture({ id: "c-2", name: "Backup" })]);
    let release: () => void = () => {};
    server.use(
      http.delete(apiUrl("/connections/c-openai"), async () => {
        await new Promise<void>((resolve) => (release = resolve));
        api.items = api.items.filter((item) => item.id !== "c-openai");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithClient(<ConnectionsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("OpenAI prod")).getByRole("button", { name: "Delete OpenAI prod" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete connection" }));
    await screen.findByRole("button", { name: "Deleting…" });
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: "Delete Backup" }));
    release();
    await waitFor(() => expect(screen.queryByRole("article", { name: /OpenAI prod/ })).not.toBeInTheDocument());
    const dialog = screen.getByRole("dialog", { name: "Delete “Backup”?" });
    await user.click(await within(dialog).findByRole("button", { name: "Delete connection" }));

    await waitFor(() => expect(screen.queryByRole("article", { name: /Backup/ })).not.toBeInTheDocument());
    expect(api.items).toEqual([]);
  });

  it("moves focus to the page heading after a delete instead of losing it", async () => {
    mockConnectionsApi([connectionFixture(), connectionFixture({ id: "c-2", name: "Backup" })]);
    renderWithClient(<ConnectionsContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("OpenAI prod")).getByRole("button", { name: "Delete OpenAI prod" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete connection" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Connections" })).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("Connections in Spanish", () => {
  it("labels each connection card in Spanish and keeps the server's test detail as sent", async () => {
    mockConnectionsApi([connectionFixture({ lastTest: passed })]);
    renderWithClient(<ConnectionsContainer />, { locale: "es" });

    const openai = await findRow("OpenAI prod");
    expect(screen.getByRole("heading", { level: 1, name: "Conexiones" })).toBeInTheDocument();
    expect(within(openai).getByText("Superada")).toBeInTheDocument();
    expect(within(openai).getByText("HTTP 200: credentials accepted")).toBeInTheDocument();
    expect(within(openai).getByRole("button", { name: "Editar OpenAI prod" })).toBeInTheDocument();
  });
});
