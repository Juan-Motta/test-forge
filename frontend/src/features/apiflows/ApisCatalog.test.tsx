import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { ApisContainer } from "./ApisContainer";
import { apiFixture, flowFixture, mockApisApi } from "./testing";

const shop = apiFixture({
  tags: ["shop", "nightly"],
  secrets: [
    { name: "apiKey", hint: "••••7890" },
    { name: "clientSecret", hint: "••••" },
  ],
});
const crm = apiFixture({
  id: "api-crm",
  name: "CRM",
  description: "Customer records.",
  tags: ["crm"],
  baseUrl: "http://localhost:8080",
  secrets: [{ name: "token", hint: "••••" }],
});
const empty = apiFixture({ id: "api-empty", name: "Empty API", description: "", tags: [], secrets: [] });
const products = flowFixture({
  lastRun: { id: "run-1", status: "failed", createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), durationMs: 120 },
});
const orders = flowFixture({ id: "f-orders", name: "List orders" });
const customers = flowFixture({ id: "f-crm", apiId: "api-crm", api: { id: "api-crm", name: "CRM" }, name: "Find a customer" });
const secrets = { "api-shop": { apiKey: "sk-live-1234567890", clientSecret: "abc" }, "api-crm": { token: "crm-token-value" } };

function setup(apis = [shop, crm], flows = [products, orders, customers]) {
  return mockApisApi(apis, { flows, secrets });
}

async function renderCatalog() {
  const user = userEvent.setup({ delay: null });
  renderWithClient(<ApisContainer />);
  const rail = await screen.findByRole("complementary", { name: "APIs" });
  return { user, rail };
}

const railItems = (rail: HTMLElement) =>
  within(within(rail).getByRole("list")).getAllByRole("button").map((button) => button.firstElementChild?.textContent);
const secretReads = (state: ReturnType<typeof setup>) => state.requests.filter((request) => request.path.endsWith("/secrets"));
const patches = (state: ReturnType<typeof setup>) =>
  state.requests.filter((request) => request.method === "PATCH").map((request) => request.body);
const card = (name: string) => screen.getByRole("region", { name });

afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("API connections", () => {
  it("lists every API in the rail with its base URL, secrets and flows, and opens the first one", async () => {
    setup();
    const { rail } = await renderCatalog();

    expect(railItems(rail)).toEqual(["CRM", "Shop API"]);
    const crmItem = within(rail).getByRole("button", { name: /CRM/ });
    expect(crmItem).toHaveAttribute("aria-current", "true");
    expect(within(crmItem).getByText("http://localhost:8080")).toBeInTheDocument();
    expect(within(crmItem).getByText("1 secret · 1 flow")).toBeInTheDocument();
    const shopItem = within(rail).getByRole("button", { name: /Shop API/ });
    expect(shopItem).not.toHaveAttribute("aria-current");
    expect(within(shopItem).getByText("2 secrets · 2 flows")).toBeInTheDocument();
  });

  it("titles the page with the open API and offers Add API and Save changes, like the agents page", async () => {
    setup();
    await renderCatalog();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CRM");
    expect(screen.getByText("The APIs your flows call: where they live and the credentials they use.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add API" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toHaveAttribute("type", "submit");
    // The details are edited in the form, not in place nor in a dialog.
    expect(screen.queryByRole("button", { name: "Rename the API CRM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit connection" })).not.toBeInTheDocument();
  });

  it("shows the connection details in the form, with secrets masked and never fetched on the way in", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    await renderCatalog();

    const connection = card("Connection");
    expect(within(connection).getByRole("textbox", { name: "Name" })).toHaveValue("Shop API");
    expect(within(connection).getByRole("textbox", { name: "Description" })).toHaveValue("Products and orders of the demo shop.");
    expect(within(connection).getByRole("textbox", { name: "Base URL" })).toHaveValue("https://shop.example.com/v1");
    expect(within(connection).getByRole("textbox", { name: "Tags" })).toHaveValue("shop, nightly");

    const stored = within(card("Secrets")).getByRole("list", { name: "Stored secrets" });
    expect(within(stored).getByText("apiKey")).toBeInTheDocument();
    expect(within(stored).getByText("••••7890")).toBeInTheDocument();
    expect(within(stored).getByText("clientSecret")).toBeInTheDocument();
    expect(within(stored).getByRole("button", { name: "Show apiKey" })).toHaveAttribute("aria-pressed", "false");
    expect(within(stored).getByLabelText("New value of apiKey")).toHaveAttribute("type", "password");
    expect(within(stored).getByRole("button", { name: "Remove the secret clientSecret" })).toBeInTheDocument();
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();

    const headers = card("Headers");
    expect(within(headers).getByRole("textbox", { name: "Header name 1" })).toHaveValue("Accept");
    expect(within(headers).getByRole("textbox", { name: "Header value 1" })).toHaveValue("application/json");

    // No flows here: they live on API → Flows.
    expect(screen.queryByRole("region", { name: "Flows" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run all/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New flow" })).not.toBeInTheDocument();
    expect(secretReads(state)).toEqual([]);
  });

  it("reveals a secret with its eye and hides it again", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    const stored = within(card("Secrets")).getByRole("list", { name: "Stored secrets" });
    await user.click(within(stored).getByRole("button", { name: "Show apiKey" }));
    expect(await within(stored).findByText("sk-live-1234567890")).toBeInTheDocument();
    expect(secretReads(state)).toHaveLength(1);
    await user.click(within(stored).getByRole("button", { name: "Hide apiKey" }));
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();
  });

  it("filters the rail by name, URL, description or tag", async () => {
    setup();
    const { user, rail } = await renderCatalog();
    const search = within(rail).getByRole("searchbox", { name: "Search APIs" });

    for (const [query, expected] of [
      ["shop", ["Shop API"]],
      ["localhost:8080", ["CRM"]],
      ["customer", ["CRM"]],
      ["nightly", ["Shop API"]],
    ] as const) {
      await user.clear(search);
      await user.type(search, query);
      expect(railItems(rail)).toEqual(expected);
    }
    await user.clear(search);
    await user.type(search, "zzz");
    expect(within(rail).getByText("No APIs match your search.")).toBeInTheDocument();
  });

  it("opens the API the address names, and writes the one picked to the address", async () => {
    setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user, rail } = await renderCatalog();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Shop API");
    expect(within(rail).getByRole("button", { name: /Shop API/ })).toHaveAttribute("aria-current", "true");

    await user.click(within(rail).getByRole("button", { name: /CRM/ }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CRM");
    expect(window.location.search).toBe("?api=api-crm");
  });

  it("follows the address on back and forward", async () => {
    setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    await renderCatalog();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Shop API");

    act(() => {
      window.history.replaceState(null, "", "/apis?api=api-crm");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CRM");
  });

  it("falls back to the first API when the address names one that does not exist", async () => {
    setup();
    window.history.replaceState(null, "", "/apis?api=gone");
    await renderCatalog();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CRM");
  });

  it("hides revealed secrets when switching APIs", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user, rail } = await renderCatalog();

    await user.click(within(card("Secrets")).getByRole("button", { name: "Show apiKey" }));
    expect(await screen.findByText("sk-live-1234567890")).toBeInTheDocument();
    expect(secretReads(state)).toHaveLength(1);

    await user.click(within(rail).getByRole("button", { name: /CRM/ }));
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    await user.click(within(rail).getByRole("button", { name: /Shop API/ }));
    expect(within(card("Secrets")).getByRole("button", { name: "Show apiKey" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    // Switching fetched nothing more.
    expect(secretReads(state)).toHaveLength(1);
  });

  it("saves only the changed base URL, then shows the saved API in a fresh form", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    await user.click(within(card("Secrets")).getByRole("button", { name: "Show apiKey" }));
    expect(await screen.findByText("sk-live-1234567890")).toBeInTheDocument();
    const baseUrl = within(card("Connection")).getByRole("textbox", { name: "Base URL" });
    await user.clear(baseUrl);
    await user.type(baseUrl, "https://shop.example.com/v2");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Saved Shop API.")).toBeInTheDocument();
    expect(patches(state)).toEqual([{ baseUrl: "https://shop.example.com/v2" }]);
    // The form starts again from what is stored: the new URL, and every secret hidden.
    expect(within(card("Connection")).getByRole("textbox", { name: "Base URL" })).toHaveValue("https://shop.example.com/v2");
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    expect(within(card("Secrets")).getByRole("button", { name: "Show apiKey" })).toHaveAttribute("aria-pressed", "false");
  });

  it("replaces one secret and removes another in one PATCH", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    const secrets = card("Secrets");
    await user.type(within(secrets).getByLabelText("New value of apiKey"), "new");
    await user.click(within(secrets).getByRole("button", { name: "Remove the secret clientSecret" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Saved Shop API.")).toBeInTheDocument();
    expect(patches(state)).toEqual([{ secrets: { apiKey: "new", clientSecret: null } }]);
    const stored = within(card("Secrets")).getByRole("list", { name: "Stored secrets" });
    expect(within(stored).queryByText("clientSecret")).not.toBeInTheDocument();
    expect(within(stored).getByLabelText("New value of apiKey")).toHaveValue("");
  });

  it("adds a secret and a header, edits name, description and tags, and sends only those", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user, rail } = await renderCatalog();

    const connection = card("Connection");
    const name = within(connection).getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Shop");
    await user.type(within(connection).getByRole("textbox", { name: "Description" }), " Demo.");
    const tags = within(connection).getByRole("textbox", { name: "Tags" });
    await user.clear(tags);
    await user.type(tags, "shop, demo, shop,");
    const secrets = card("Secrets");
    await user.click(within(secrets).getByRole("button", { name: "Add secret" }));
    await user.type(within(secrets).getByRole("textbox", { name: "Secret name 1" }), "token");
    await user.type(within(secrets).getByLabelText("Secret value 1"), "t0k3n");
    const headers = card("Headers");
    await user.click(within(headers).getByRole("button", { name: "Add header" }));
    await user.type(within(headers).getByRole("textbox", { name: "Header name 2" }), "X-Env");
    await user.type(within(headers).getByRole("textbox", { name: "Header value 2" }), "test");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(railItems(rail)).toEqual(["CRM", "Shop"]));
    expect(patches(state)).toEqual([
      {
        name: "Shop",
        description: "Products and orders of the demo shop. Demo.",
        tags: ["shop", "demo"],
        headers: [
          { name: "Accept", value: "application/json" },
          { name: "X-Env", value: "test" },
        ],
        secrets: { token: "t0k3n" },
      },
    ]);
  });

  it("sends nothing when nothing changed", async () => {
    const state = setup();
    const { user } = await renderCatalog();
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("No changes to save.")).toBeInTheDocument();
    expect(patches(state)).toEqual([]);
  });

  it("shows a taken name (409) on the name field and a refused base URL (422) on its field", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    const connection = card("Connection");
    const name = within(connection).getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "CRM");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await within(connection).findByText("An API with this name already exists. Try another.")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");
    // The edit stays in the form.
    expect(name).toHaveValue("CRM");

    await user.clear(name);
    await user.type(name, "Shop API");
    const baseUrl = within(connection).getByRole("textbox", { name: "Base URL" });
    await user.clear(baseUrl);
    await user.type(baseUrl, "http://intranet.example.com");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Check the highlighted fields.")).toBeInTheDocument();
    expect(baseUrl).toHaveAttribute("aria-invalid", "true");
    expect(name).not.toHaveAttribute("aria-invalid");
    expect(state.items.find((item) => item.id === "api-shop")?.baseUrl).toBe("https://shop.example.com/v1");
  });

  it("asks for the name and base URL before sending anything", async () => {
    const state = setup();
    const { user } = await renderCatalog();
    const connection = card("Connection");
    await user.clear(within(connection).getByRole("textbox", { name: "Name" }));
    await user.clear(within(connection).getByRole("textbox", { name: "Base URL" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(within(connection).getByText("Enter a name.")).toBeInTheDocument();
    expect(within(connection).getByText("Enter the base URL.")).toBeInTheDocument();
    expect(patches(state)).toEqual([]);
  });

  it("asks before switching APIs with unsaved edits, and stays when declined", async () => {
    setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user, rail } = await renderCatalog();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    const baseUrl = within(card("Connection")).getByRole("textbox", { name: "Base URL" });
    await user.type(baseUrl, "/v2");
    await user.click(within(rail).getByRole("button", { name: /CRM/ }));
    expect(confirm).toHaveBeenCalledWith("You have unsaved changes. Leave this page and discard them?");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Shop API");
    expect(baseUrl).toHaveValue("https://shop.example.com/v1/v2");

    confirm.mockReturnValue(true);
    await user.click(within(rail).getByRole("button", { name: /CRM/ }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CRM");
    expect(window.location.search).toBe("?api=api-crm");
    // Back on the first API, the discarded edit is gone and nothing asks any more.
    confirm.mockClear();
    await user.click(within(rail).getByRole("button", { name: /Shop API/ }));
    expect(confirm).not.toHaveBeenCalled();
    expect(within(card("Connection")).getByRole("textbox", { name: "Base URL" })).toHaveValue("https://shop.example.com/v1");
  });

  it("switches APIs without asking when nothing was edited", async () => {
    setup();
    const { user, rail } = await renderCatalog();
    const confirm = vi.spyOn(window, "confirm");
    await user.click(within(rail).getByRole("button", { name: /Shop API/ }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Shop API");
  });

  it("opens the new API form beside the rail from Add API", async () => {
    setup();
    const { user } = await renderCatalog();
    await user.click(screen.getByRole("button", { name: "Add API" }));
    expect(screen.getByRole("region", { name: "New API" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("API connections");
    expect(screen.queryByRole("form", { name: "API connection" })).not.toBeInTheDocument();
  });

  it("asks before leaving a half-typed new API for one in the rail", async () => {
    setup();
    const { user } = await renderCatalog();
    await user.click(screen.getByRole("button", { name: "Add API" }));
    const form = screen.getByRole("region", { name: "New API" });
    await user.type(within(form).getByRole("textbox", { name: "Name" }), "Billing");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    const rail = screen.getByRole("complementary", { name: "APIs" });
    await user.click(within(rail).getByRole("button", { name: /CRM/ }));
    expect(confirm).toHaveBeenCalled();
    expect(within(screen.getByRole("region", { name: "New API" })).getByRole("textbox", { name: "Name" })).toHaveValue("Billing");

    confirm.mockReturnValue(true);
    await user.click(within(rail).getByRole("button", { name: /CRM/ }));
    expect(screen.queryByRole("region", { name: "New API" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CRM");
  });

  it("deletes an API without flows after confirming, then opens another one", async () => {
    const state = setup([shop, crm, empty]);
    window.history.replaceState(null, "", "/apis?api=api-empty");
    const { user, rail } = await renderCatalog();

    await user.click(screen.getByRole("button", { name: "Delete Empty API" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Empty API”?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete API" }));

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Shop API"));
    expect(state.items.map((item) => item.id)).toEqual(["api-shop", "api-crm"]);
    expect(railItems(rail)).toEqual(["CRM", "Shop API"]);
    expect(window.location.search).toBe("?api=api-shop");
  });

  it("offers no delete while the API holds flows", async () => {
    setup();
    await renderCatalog();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CRM");
    expect(screen.queryByRole("button", { name: "Delete CRM" })).not.toBeInTheDocument();
  });

  it("shows the empty state with New API", async () => {
    setup([]);
    const user = userEvent.setup({ delay: null });
    renderWithClient(<ApisContainer />);
    expect(await screen.findByRole("heading", { name: "No APIs yet" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New API" }));
    expect(screen.getByRole("region", { name: "New API" })).toBeInTheDocument();
  });

  it("offers a retry when the APIs cannot be loaded", async () => {
    let calls = 0;
    server.use(
      http.get(apiUrl("/apis"), () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json({ detail: "boom" }, { status: 500 }) : HttpResponse.json([crm]);
      }),
      http.get(apiUrl("/flows"), () => HttpResponse.json([])),
    );
    const user = userEvent.setup({ delay: null });
    renderWithClient(<ApisContainer />);
    expect(await screen.findByText("The APIs could not be loaded.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("complementary", { name: "APIs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CRM");
  });

  it("creates an API with its secrets and headers, then opens it", async () => {
    const state = setup();
    const { user, rail } = await renderCatalog();

    await user.click(within(rail).getByRole("button", { name: "New API" }));
    const dialog = screen.getByRole("region", { name: "New API" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("API connections");
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "Billing");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Invoices.");
    await user.type(within(dialog).getByRole("textbox", { name: "Base URL" }), "https://billing.example.com");
    await user.click(within(dialog).getByRole("button", { name: "Add secret" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Secret name 1" }), "token");
    const value = within(dialog).getByLabelText("Secret value 1");
    expect(value).toHaveAttribute("type", "password");
    await user.type(value, "s3cr3t-value");
    await user.click(within(dialog).getByRole("button", { name: "Add header" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Header name 1" }), "Accept");
    await user.type(within(dialog).getByRole("textbox", { name: "Header value 1" }), "application/json");
    await user.click(within(dialog).getByRole("button", { name: "Create API" }));

    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Billing"));
    expect(screen.queryByRole("region", { name: "New API" })).not.toBeInTheDocument();
    // The form sits beside the rail, so the rail is a fresh element once the API opens.
    const after = screen.getByRole("complementary", { name: "APIs" });
    expect(within(after).getByRole("button", { name: /Billing/ })).toHaveAttribute("aria-current", "true");
    expect(window.location.search).toBe("?api=api-new-1");
    expect(state.requests.filter((request) => request.method === "POST")).toEqual([
      {
        method: "POST",
        path: "/apis",
        body: {
          name: "Billing",
          description: "Invoices.",
          baseUrl: "https://billing.example.com",
          headers: [{ name: "Accept", value: "application/json" }],
          secrets: { token: "s3cr3t-value" },
        },
      },
    ]);
    expect(secretReads(state)).toEqual([]);
  });

  it("shows a taken name (409) and a refused base URL (422) on the new API's fields", async () => {
    const state = setup();
    const { user, rail } = await renderCatalog();

    await user.click(within(rail).getByRole("button", { name: "New API" }));
    const dialog = screen.getByRole("region", { name: "New API" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    const baseUrl = within(dialog).getByRole("textbox", { name: "Base URL" });
    await user.type(name, "CRM");
    await user.type(baseUrl, "https://crm.example.com");
    await user.click(within(dialog).getByRole("button", { name: "Create API" }));
    expect(await within(dialog).findByText("An API with this name already exists. Try another.")).toBeInTheDocument();
    expect(name).toHaveAttribute("aria-invalid", "true");

    await user.clear(name);
    await user.type(name, "Intranet");
    await user.clear(baseUrl);
    await user.type(baseUrl, "http://intranet.example.com");
    await user.click(within(dialog).getByRole("button", { name: "Create API" }));
    expect(await within(dialog).findByText("Check the highlighted fields.")).toBeInTheDocument();
    expect(baseUrl).toHaveAttribute("aria-invalid", "true");
    expect(within(dialog).getByText(/use https, or http only to localhost/)).toBeInTheDocument();
    expect(state.items.map((item) => item.name)).toEqual(["Shop API", "CRM"]);
  });

  it("asks for the name and base URL before creating anything", async () => {
    const state = setup();
    const { user, rail } = await renderCatalog();
    await user.click(within(rail).getByRole("button", { name: "New API" }));
    const dialog = screen.getByRole("region", { name: "New API" });
    await user.click(within(dialog).getByRole("button", { name: "Create API" }));
    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter the base URL.")).toBeInTheDocument();
    expect(state.requests.filter((request) => request.method === "POST")).toEqual([]);
  });
});
