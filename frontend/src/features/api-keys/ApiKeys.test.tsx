import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server, TEST_ORIGIN } from "@/test/server";
import { ApiKeysContainer } from "./ApiKeysContainer";
import { apiKeyFixture, createdSecret, mockApiKeysApi } from "./testing";

async function findRow(name: string) {
  return screen.findByRole("row", { name: new RegExp(name) });
}

describe("API keys list", () => {
  it("keeps the keys table in a titled panel and links the API docs in a new tab", async () => {
    mockApiKeysApi([apiKeyFixture()]);
    renderWithClient(<ApiKeysContainer />);

    const panel = await screen.findByRole("region", { name: "Your keys" });
    expect(await within(panel).findByRole("table", { name: "API keys" })).toBeInTheDocument();
    const docs = screen.getByRole("link", { name: "API docs (opens in a new tab)" });
    expect(docs).toHaveAttribute("href", "/api/docs");
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", expect.stringContaining("noopener"));
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
  });

  it("shows only the active keys by default, and the revoked or all of them on demand", async () => {
    mockApiKeysApi([
      apiKeyFixture(),
      apiKeyFixture({ id: "k-old", name: "Old script", prefix: "ve_old00000", expiresAt: "2026-01-01T00:00:00Z" }),
      apiKeyFixture({ id: "k-gone", name: "Agent", prefix: "ve_gone0000", revokedAt: "2026-10-05T00:00:00Z" }),
    ]);
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();
    const names = () =>
      within(screen.getByRole("table", { name: "API keys" }))
        .getAllByRole("row")
        .slice(1)
        .map((row) => row.textContent);

    await findRow("CI pipeline");
    const filter = screen.getByRole("radiogroup", { name: "Show keys" });
    expect(within(filter).getByRole("radio", { name: "Active" })).toBeChecked();
    expect(names()).toEqual([expect.stringContaining("CI pipeline")]);

    await user.click(within(filter).getByRole("radio", { name: "Revoked" }));
    expect(names()).toEqual([expect.stringContaining("Agent")]);

    // Expired keys are neither: only All lists them.
    await user.click(within(filter).getByRole("radio", { name: "All" }));
    expect(names()).toHaveLength(3);
  });

  it("says when no key is in the chosen view", async () => {
    mockApiKeysApi([apiKeyFixture({ revokedAt: "2026-10-05T00:00:00Z" })]);
    renderWithClient(<ApiKeysContainer />);

    expect(await screen.findByText("No active keys. Create one, or show the revoked or all keys.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "API keys" })).not.toBeInTheDocument();
  });

  it("shows each key with its prefix, dates and status", async () => {
    mockApiKeysApi([
      apiKeyFixture({ lastUsedAt: new Date(Date.now() - 2.5 * 3_600_000).toISOString() }),
      apiKeyFixture({
        id: "k-old",
        name: "Old script",
        prefix: "ve_old00000",
        expiresAt: "2026-01-01T00:00:00Z",
      }),
      apiKeyFixture({ id: "k-gone", name: "Agent", prefix: "ve_gone0000", revokedAt: "2026-10-05T00:00:00Z" }),
    ]);
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();
    await findRow("CI pipeline");
    await user.click(screen.getByRole("radio", { name: "All" }));

    const ci = await findRow("CI pipeline");
    expect(within(ci).getByText("ve_abcd1234…")).toBeInTheDocument();
    expect(within(ci).getByText("2 hours ago")).toBeInTheDocument();
    expect(within(ci).getByText("Never")).toBeInTheDocument(); // no expiry
    expect(within(ci).getByText("Active")).toBeInTheDocument();
    const revoke = within(ci).getByRole("button", { name: "Revoke CI pipeline" });
    // An icon button (trash) with its name as a tooltip, not a text button.
    expect(revoke).toHaveAttribute("title", "Revoke CI pipeline");
    expect(revoke.textContent).toBe("");

    const old = await findRow("Old script");
    expect(within(old).getByText("Expired")).toBeInTheDocument();
    expect(within(old).getAllByText("Never")).toHaveLength(1); // never used

    const revoked = await findRow("Agent");
    expect(within(revoked).getByText("Revoked")).toBeInTheDocument();
    expect(within(revoked).queryByRole("button", { name: /Revoke/ })).not.toBeInTheDocument();
  });

  it("shows an empty state whose call to action opens the create dialog", async () => {
    mockApiKeysApi([]);
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();

    expect(await screen.findByRole("heading", { name: "No API keys yet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create your first API key" }));

    expect(screen.getByRole("dialog", { name: "Create API key" })).toBeInTheDocument();
  });

  it("shows an error with a retry when the list cannot be loaded", async () => {
    let calls = 0;
    server.use(
      http.get(apiUrl("/api-keys"), () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ detail: "Database unavailable" }, { status: 503 })
          : HttpResponse.json([apiKeyFixture()]);
      }),
    );
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load API keys");
    expect(alert).toHaveTextContent("Database unavailable");
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await findRow("CI pipeline")).toBeInTheDocument();
  });
});

describe("Creating an API key", () => {
  it("requires a name before sending anything", async () => {
    const api = mockApiKeysApi([]);
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Create API key" }));
    const dialog = screen.getByRole("dialog", { name: "Create API key" });
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));

    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");
    expect(api.requests).toEqual([]);
  });

  it("shows the new key once, copies it, and forgets it when closed", async () => {
    const api = mockApiKeysApi([apiKeyFixture()]);
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();
    await findRow("CI pipeline");
    const listCallsBefore = api.listCalls;

    await user.click(screen.getByRole("button", { name: "Create API key" }));
    let dialog = screen.getByRole("dialog", { name: "Create API key" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "  Nightly CI  ");
    await user.selectOptions(within(dialog).getByRole("combobox", { name: "Expires" }), "90 days");
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));

    dialog = await screen.findByRole("dialog", { name: "Copy your new API key" });
    expect(api.requests).toEqual([{ method: "POST", path: "/api-keys", body: { name: "Nightly CI", expiresInDays: 90 } }]);
    const secret = createdSecret(1);
    expect(within(dialog).getByRole("textbox", { name: "API key" })).toHaveValue(secret);
    expect(within(dialog).getByRole("textbox", { name: "API key" })).toHaveAttribute("readonly");
    expect(within(dialog).getByText("You won't see this key again.", { exact: false })).toBeInTheDocument();
    expect(
      within(dialog).getByText(`curl -H "Authorization: Bearer ${secret}" ${TEST_ORIGIN}/api/runs`),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(secret);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Copied");

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(secret)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(secret);
    expect(await findRow("Nightly CI")).toBeInTheDocument();
    expect(api.listCalls).toBeGreaterThan(listCallsBefore);

    // Opening the dialog again starts from an empty form, not the previous key.
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    dialog = screen.getByRole("dialog", { name: "Create API key" });
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("");
    expect(document.body.textContent).not.toContain(secret);
  });

  it("sends no expiry when the key never expires", async () => {
    const api = mockApiKeysApi([]);
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Create API key" }));
    const dialog = screen.getByRole("dialog", { name: "Create API key" });
    expect(within(dialog).getByRole("combobox", { name: "Expires" })).toHaveDisplayValue("Never");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Agent");
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));

    await screen.findByRole("dialog", { name: "Copy your new API key" });
    expect(api.requests).toEqual([{ method: "POST", path: "/api-keys", body: { name: "Agent", expiresInDays: null } }]);
  });

  it("shows a create error inside the dialog and keeps the form", async () => {
    mockApiKeysApi([]);
    server.use(
      http.post(apiUrl("/api-keys"), () => HttpResponse.json({ detail: "Too many API keys" }, { status: 400 })),
    );
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Create API key" }));
    const dialog = screen.getByRole("dialog", { name: "Create API key" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Agent");
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Too many API keys");
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Agent");
  });
});

describe("Revoking an API key", () => {
  it("revokes only after the user confirms in a dialog naming the key", async () => {
    const api = mockApiKeysApi([apiKeyFixture(), apiKeyFixture({ id: "k-2", name: "Backup" })]);
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("CI pipeline")).getByRole("button", { name: "Revoke CI pipeline" }));
    let dialog = screen.getByRole("dialog", { name: "Revoke “CI pipeline”?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.requests).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Revoke CI pipeline" }));
    dialog = screen.getByRole("dialog", { name: "Revoke “CI pipeline”?" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke key" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests).toEqual([{ method: "DELETE", path: "/api-keys/k-ci", body: undefined }]);
    // Leaves the Active view, which keeps the other key.
    await waitFor(() => expect(screen.queryByRole("row", { name: /CI pipeline/ })).not.toBeInTheDocument());
    expect(within(screen.getByRole("row", { name: /Backup/ })).getByText("Active")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Revoked" }));
    expect(within(screen.getByRole("row", { name: /CI pipeline/ })).getByText("Revoked")).toBeInTheDocument();
  });

  it("sends a single request when the confirm button is clicked twice", async () => {
    const api = mockApiKeysApi([apiKeyFixture()]);
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("CI pipeline")).getByRole("button", { name: "Revoke CI pipeline" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke key" });
    confirm.click();
    confirm.click();

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests).toHaveLength(1);
  });

  it("shows a revoke error in the dialog and lets the user try again", async () => {
    const api = mockApiKeysApi([apiKeyFixture()]);
    let fail = true;
    server.use(
      http.delete(apiUrl("/api-keys/:id"), () => {
        if (!fail) return undefined;
        fail = false;
        return HttpResponse.json({ detail: "Database unavailable" }, { status: 503 });
      }),
    );
    renderWithClient(<ApiKeysContainer />);
    const user = userEvent.setup();

    await user.click(within(await findRow("CI pipeline")).getByRole("button", { name: "Revoke CI pipeline" }));
    const dialog = screen.getByRole("dialog", { name: "Revoke “CI pipeline”?" });
    await user.click(within(dialog).getByRole("button", { name: "Revoke key" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Database unavailable");
    const retry = within(dialog).getByRole("button", { name: "Revoke key" });
    expect(retry).toBeEnabled();
    await user.click(retry);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.requests).toEqual([{ method: "DELETE", path: "/api-keys/k-ci", body: undefined }]);
  });
});

describe("API keys in Spanish", () => {
  it("shows the keys table and its dates in Spanish", async () => {
    mockApiKeysApi([apiKeyFixture({ lastUsedAt: new Date(Date.now() - 2.5 * 3_600_000).toISOString() })]);
    renderWithClient(<ApiKeysContainer />, { locale: "es" });

    const ci = await findRow("CI pipeline");
    expect(screen.getByRole("heading", { level: 1, name: "Claves de API" })).toBeInTheDocument();
    expect(within(ci).getByText("hace 2 horas")).toBeInTheDocument();
    expect(within(ci).getByText("Nunca")).toBeInTheDocument();
    expect(within(ci).getByText("Activa")).toBeInTheDocument();
    expect(within(ci).getByRole("button", { name: "Revocar CI pipeline" })).toBeInTheDocument();
  });
});
