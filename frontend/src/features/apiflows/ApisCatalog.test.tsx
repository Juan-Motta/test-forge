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
  headers: [
    { name: "Accept", value: "application/json" },
    { name: "x-api-key", value: "{{secret.x_api_key}}" },
  ],
  variables: { tenant_id: "acme" },
  secrets: [
    { name: "x_api_key", hint: "••••7890" },
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
const secrets = { "api-shop": { x_api_key: "sk-live-1234567890", clientSecret: "abc" }, "api-crm": { token: "crm-token-value" } };

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

    // Variables, open: plain values as stored, secrets masked with their eye.
    const variables = card("Variables");
    expect(within(variables).getByText(/Use them in any step as \{\{var\.name\}\}/)).toBeInTheDocument();
    expect(within(variables).getByRole("textbox", { name: "Value of tenant_id" })).toHaveValue("acme");
    expect(within(variables).getByRole("switch", { name: "Keep the variable tenant_id secret" })).not.toBeChecked();
    expect(within(variables).getByRole("switch", { name: "Keep the variable x_api_key secret" })).toBeChecked();
    expect(within(variables).getByText("••••7890")).toBeInTheDocument();
    expect(within(variables).getByRole("button", { name: "Show x_api_key" })).toHaveAttribute("aria-pressed", "false");
    expect(within(variables).getByRole("button", { name: "Show clientSecret" })).toBeInTheDocument();
    const replace = within(variables).getByLabelText("New value of x_api_key");
    expect(replace).toHaveAttribute("type", "password");
    expect(replace).toHaveAttribute("placeholder", "Replace value");
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();

    // Default headers are plain templates: a legacy header sending a secret shows as written.
    const headers = card("Default headers");
    expect(within(headers).getByText("Sent on every step. Leave out what only some steps need (like a login token).")).toBeInTheDocument();
    expect(within(headers).getByRole("textbox", { name: "Header name 1" })).toHaveValue("Accept");
    expect(within(headers).getByRole("textbox", { name: "Header value 1" })).toHaveValue("application/json");
    expect(within(headers).getByRole("textbox", { name: "Header name 2" })).toHaveValue("x-api-key");
    expect(within(headers).getByRole("textbox", { name: "Header value 2" })).toHaveValue("{{secret.x_api_key}}");
    expect(within(headers).queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText(/advanced/)).not.toBeInTheDocument();

    // No flows here: they live on API → Flows.
    expect(screen.queryByRole("region", { name: "Flows" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run all/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New flow" })).not.toBeInTheDocument();
    expect(secretReads(state)).toEqual([]);
  });

  it("reveals a secret with its eye, and hides it again by the eye or by turning it plain", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    const variables = card("Variables");
    await user.click(within(variables).getByRole("button", { name: "Show x_api_key" }));
    expect(await within(variables).findByText("sk-live-1234567890")).toBeInTheDocument();
    expect(secretReads(state)).toHaveLength(1);
    // The other secret stays masked.
    expect(within(variables).queryByText("abc")).not.toBeInTheDocument();
    await user.click(within(variables).getByRole("button", { name: "Hide x_api_key" }));
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();

    await user.click(within(variables).getByRole("button", { name: "Show x_api_key" }));
    expect(await within(variables).findByText("sk-live-1234567890")).toBeInTheDocument();
    const toggle = within(variables).getByRole("switch", { name: "Keep the variable x_api_key secret" });
    await user.click(toggle);
    // Turned plain: the value field starts empty, never with the secret's value.
    expect(within(variables).getByRole("textbox", { name: "Value of x_api_key" })).toHaveValue("");
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(within(variables).getByRole("button", { name: "Show x_api_key" })).toHaveAttribute("aria-pressed", "false");
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

    await user.click(within(card("Variables")).getByRole("button", { name: "Show x_api_key" }));
    expect(await screen.findByText("sk-live-1234567890")).toBeInTheDocument();
    expect(secretReads(state)).toHaveLength(1);

    await user.click(within(rail).getByRole("button", { name: /CRM/ }));
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    await user.click(within(rail).getByRole("button", { name: /Shop API/ }));
    expect(within(card("Variables")).getByRole("button", { name: "Show x_api_key" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    // Switching fetched nothing more.
    expect(secretReads(state)).toHaveLength(1);
  });

  it("saves only the changed base URL, then shows the saved API in a fresh form", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    await user.click(within(card("Variables")).getByRole("button", { name: "Show x_api_key" }));
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
    expect(within(card("Variables")).getByRole("button", { name: "Show x_api_key" })).toHaveAttribute("aria-pressed", "false");
  });

  it("edits a plain variable, sending only its new value", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    const value = within(card("Variables")).getByRole("textbox", { name: "Value of tenant_id" });
    await user.clear(value);
    await user.type(value, "globex");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Saved Shop API.")).toBeInTheDocument();
    expect(patches(state)).toEqual([{ variables: { tenant_id: "globex" } }]);
    expect(within(card("Variables")).getByRole("textbox", { name: "Value of tenant_id" })).toHaveValue("globex");
    expect(secretReads(state)).toEqual([]);
  });

  it("replaces a secret's value and removes variables, plain and secret, in one PATCH", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    const variables = card("Variables");
    await user.type(within(variables).getByLabelText("New value of x_api_key"), "new");
    await user.click(within(variables).getByRole("button", { name: "Remove the variable clientSecret" }));
    await user.click(within(variables).getByRole("button", { name: "Remove the variable tenant_id" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Saved Shop API.")).toBeInTheDocument();
    expect(patches(state)).toEqual([{ variables: { tenant_id: null }, secrets: { x_api_key: "new", clientSecret: null } }]);
    const saved = card("Variables");
    expect(within(saved).getByLabelText("New value of x_api_key")).toHaveValue("");
    expect(within(saved).queryByText("clientSecret")).not.toBeInTheDocument();
    expect(within(saved).queryByRole("textbox", { name: "Value of tenant_id" })).not.toBeInTheDocument();
  });

  it("turns a plain variable secret in one PATCH that moves its value", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    await user.click(within(card("Variables")).getByRole("switch", { name: "Keep the variable tenant_id secret" }));
    // Its value moves along, now masked as it is typed.
    expect(within(card("Variables")).getByLabelText("Value of tenant_id")).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText("Saved Shop API.")).toBeInTheDocument();
    expect(patches(state)).toEqual([{ variables: { tenant_id: null }, secrets: { tenant_id: "acme" } }]);
    expect(state.secrets["api-shop"].tenant_id).toBe("acme");
    const saved = card("Variables");
    expect(within(saved).getByRole("switch", { name: "Keep the variable tenant_id secret" })).toBeChecked();
    expect(within(saved).getByRole("button", { name: "Show tenant_id" })).toHaveAttribute("aria-pressed", "false");
    expect(secretReads(state)).toEqual([]);
  });

  it("turns a secret plain in one PATCH, asking for its value first", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    const variables = card("Variables");
    await user.click(within(variables).getByRole("switch", { name: "Keep the variable clientSecret secret" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(
      await within(variables).findByText("Enter a value for each new secret, and for each variable you switch between plain and secret."),
    ).toBeInTheDocument();
    expect(patches(state)).toEqual([]);

    await user.type(within(variables).getByRole("textbox", { name: "Value of clientSecret" }), "visible");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Saved Shop API.")).toBeInTheDocument();
    expect(patches(state)).toEqual([{ variables: { clientSecret: "visible" }, secrets: { clientSecret: null } }]);
    expect(within(card("Variables")).getByRole("textbox", { name: "Value of clientSecret" })).toHaveValue("visible");
  });

  it("asks for the value of a new secret before sending anything", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-crm");
    const { user } = await renderCatalog();

    const variables = card("Variables");
    await user.click(within(variables).getByRole("button", { name: "Add variable" }));
    await user.type(within(variables).getByRole("textbox", { name: "Variable name 1" }), "password");
    await user.click(within(variables).getByRole("switch", { name: "Keep the variable password secret" }));
    expect(within(variables).getByLabelText("Variable value 1")).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(
      await within(variables).findByText("Enter a value for each new secret, and for each variable you switch between plain and secret."),
    ).toBeInTheDocument();
    expect(patches(state)).toEqual([]);
  });

  it("shows a name the API already holds as a secret (422) on its row", async () => {
    const state = setup();
    window.history.replaceState(null, "", "/apis?api=api-crm");
    const { user } = await renderCatalog();
    // Someone else stored a secret with that name meanwhile.
    state.secrets["api-crm"].region = "eu-secret";

    const variables = card("Variables");
    await user.click(within(variables).getByRole("button", { name: "Add variable" }));
    await user.type(within(variables).getByRole("textbox", { name: "Variable name 1" }), "region");
    await user.type(within(variables).getByRole("textbox", { name: "Variable value 1" }), "eu");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await within(variables).findByText("'region' is already a secret of this API")).toBeInTheDocument();
    expect(within(variables).getByRole("textbox", { name: "Variable name 1" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Check the highlighted fields.")).toBeInTheDocument();
    expect(state.items.find((item) => item.id === "api-crm")?.variables).toEqual({});
  });

  it("adds a variable and a default header, edits name, description and tags, and sends only those", async () => {
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
    const variables = card("Variables");
    await user.click(within(variables).getByRole("button", { name: "Add variable" }));
    await user.type(within(variables).getByRole("textbox", { name: "Variable name 1" }), "api_version");
    await user.type(within(variables).getByRole("textbox", { name: "Variable value 1" }), "2");
    const headers = card("Default headers");
    await user.click(within(headers).getByRole("button", { name: "Add header" }));
    await user.type(within(headers).getByRole("textbox", { name: "Header name 3" }), "X-Tenant");
    // A default header is a plain template: it may use a variable.
    await user.click(within(headers).getByRole("textbox", { name: "Header value 3" }));
    await user.paste("{{var.tenant_id}}");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(railItems(rail)).toEqual(["CRM", "Shop"]));
    expect(patches(state)).toEqual([
      {
        name: "Shop",
        description: "Products and orders of the demo shop. Demo.",
        tags: ["shop", "demo"],
        headers: [
          { name: "Accept", value: "application/json" },
          { name: "x-api-key", value: "{{secret.x_api_key}}" },
          { name: "X-Tenant", value: "{{var.tenant_id}}" },
        ],
        variables: { api_version: "2" },
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

  it("creates an API with a plain and a secret variable and a default header, then opens it", async () => {
    const state = setup();
    const { user, rail } = await renderCatalog();

    await user.click(within(rail).getByRole("button", { name: "New API" }));
    const form = screen.getByRole("region", { name: "New API" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("API connections");
    await user.type(within(form).getByRole("textbox", { name: "Name" }), "Billing");
    await user.type(within(form).getByRole("textbox", { name: "Description" }), "Invoices.");
    await user.type(within(form).getByRole("textbox", { name: "Base URL" }), "https://billing.example.com");
    const variables = within(form).getByRole("group", { name: "Variables" });
    expect(within(variables).getByText(/Use them in any step as \{\{var\.name\}\}/)).toBeInTheDocument();
    await user.click(within(variables).getByRole("button", { name: "Add variable" }));
    await user.type(within(variables).getByRole("textbox", { name: "Variable name 1" }), "tenant_id");
    await user.type(within(variables).getByRole("textbox", { name: "Variable value 1" }), "acme");
    await user.click(within(variables).getByRole("button", { name: "Add variable" }));
    await user.type(within(variables).getByRole("textbox", { name: "Variable name 2" }), "password");
    await user.click(within(variables).getByRole("switch", { name: "Keep the variable password secret" }));
    const secret = within(variables).getByLabelText("Variable value 2");
    expect(secret).toHaveAttribute("type", "password");
    await user.type(secret, "s3cr3t-value");
    await user.click(within(form).getByRole("button", { name: "Add header" }));
    await user.type(within(form).getByRole("textbox", { name: "Header name 1" }), "Accept");
    await user.type(within(form).getByRole("textbox", { name: "Header value 1" }), "application/json");
    await user.click(within(form).getByRole("button", { name: "Create API" }));

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
          variables: { tenant_id: "acme" },
          secrets: { password: "s3cr3t-value" },
        },
      },
    ]);
    // Opened: the plain value as typed, the secret masked with its eye, nothing fetched.
    const opened = card("Variables");
    expect(within(opened).getByRole("textbox", { name: "Value of tenant_id" })).toHaveValue("acme");
    expect(within(opened).getByRole("button", { name: "Show password" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("s3cr3t-value")).not.toBeInTheDocument();
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
