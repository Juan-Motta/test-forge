import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { afterEach, describe, expect, it } from "vitest";
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

afterEach(() => window.history.replaceState(null, "", "/"));

describe("API connections", () => {
  it("lists every API in the rail with its base URL, secrets and flows, and opens the first one", async () => {
    const state = setup();
    const { rail } = await renderCatalog();

    expect(railItems(rail)).toEqual(["CRM", "Shop API"]);
    const crmItem = within(rail).getByRole("button", { name: /CRM/ });
    expect(crmItem).toHaveAttribute("aria-current", "true");
    expect(within(crmItem).getByText("http://localhost:8080")).toBeInTheDocument();
    expect(within(crmItem).getByText("1 secret · 1 flow")).toBeInTheDocument();
    const shopItem = within(rail).getByRole("button", { name: /Shop API/ });
    expect(shopItem).not.toHaveAttribute("aria-current");
    expect(within(shopItem).getByText("2 secrets · 2 flows")).toBeInTheDocument();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("CRM");
    expect(screen.getByRole("button", { name: "Rename the API CRM" })).toBeInTheDocument();
    expect(screen.getByText("Customer records.")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "API tags" })).getByText("crm")).toBeInTheDocument();
    const connection = screen.getByRole("list", { name: "Connection" });
    expect(within(connection).getByText("http://localhost:8080")).toBeInTheDocument();
    expect(within(connection).getByRole("button", { name: "Show token" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Edit connection" })).toBeInTheDocument();
    // The values are never asked for on the way in.
    expect(secretReads(state)).toEqual([]);
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

    const connection = screen.getByRole("list", { name: "Connection" });
    await user.click(within(connection).getByRole("button", { name: "Show apiKey" }));
    expect(await within(connection).findByText("sk-live-1234567890")).toBeInTheDocument();
    expect(secretReads(state)).toHaveLength(1);

    await user.click(within(rail).getByRole("button", { name: /CRM/ }));
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    await user.click(within(rail).getByRole("button", { name: /Shop API/ }));
    const again = screen.getByRole("list", { name: "Connection" });
    expect(within(again).getByRole("button", { name: "Show apiKey" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    // Switching fetched nothing more.
    expect(secretReads(state)).toHaveLength(1);
  });

  it("lists the open API's flows with their methods and last run, New flow and Run all", async () => {
    setup();
    window.history.replaceState(null, "", "/apis?api=api-shop");
    const { user } = await renderCatalog();

    const card = screen.getByRole("region", { name: "Flows" });
    const list = await within(card).findByRole("list", { name: "Flows of Shop API" });
    const first = within(list).getByRole("link", { name: /Search products/ });
    expect(first).toHaveAttribute("href", "/apis/api-shop?flow=f-products");
    expect(within(first).getByText("POST")).toBeInTheDocument();
    expect(within(first).getByText("GET")).toBeInTheDocument();
    expect(within(first).getByText("Failed")).toBeInTheDocument();
    expect(within(first).getByText("5 minutes ago")).toBeInTheDocument();
    const second = within(list).getByRole("link", { name: /List orders/ });
    expect(second).toHaveAttribute("href", "/apis/api-shop?flow=f-orders");
    expect(within(second).getByText("Never run")).toBeInTheDocument();
    expect(within(list).queryByText("Find a customer")).not.toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "New flow" })).toHaveAttribute("href", "/apis/api-shop?new=flow");

    await user.click(within(card).getByRole("button", { name: "Run all flows of Shop API" }));
    expect(await screen.findByRole("dialog", { name: "Run 2 flows" })).toBeInTheDocument();
  });

  it("offers New flow but no Run all or flow list when the API has no flows", async () => {
    setup([shop, empty]);
    window.history.replaceState(null, "", "/apis?api=api-empty");
    await renderCatalog();
    const card = screen.getByRole("region", { name: "Flows" });
    expect(await within(card).findByText("No flows yet.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "New flow" })).toHaveAttribute("href", "/apis/api-empty?new=flow");
    expect(within(card).queryByRole("button", { name: /Run all/ })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Delete CRM" })).not.toBeInTheDocument();
  });

  it("renames the open API in place", async () => {
    const state = setup();
    const { user, rail } = await renderCatalog();
    await user.click(screen.getByRole("button", { name: "Rename the API CRM" }));
    const input = screen.getByRole("textbox", { name: "Rename the API CRM" });
    await user.clear(input);
    await user.type(input, "Customers{Enter}");
    await waitFor(() => expect(railItems(rail)).toEqual(["Customers", "Shop API"]));
    expect(state.requests.filter((request) => request.method === "PATCH").map((request) => request.body)).toEqual([
      { name: "Customers" },
    ]);
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

  it("shows a taken name (409) on the name field and a refused base URL (422) on its field", async () => {
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

  it("asks for the name and base URL before sending anything", async () => {
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
