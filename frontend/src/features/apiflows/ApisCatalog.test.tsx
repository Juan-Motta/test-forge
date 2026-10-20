import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentFixture, mockAgentsApi } from "@/features/agents/testing";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { ApisContainer } from "./ApisContainer";
import { apiFixture, flowFixture, mockApisApi } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
}));

const hotel = agentFixture();
const support = agentFixture({ id: "a-support", name: "Support triage" });
const agents = [hotel, support];

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
  secrets: [],
});
const flows = [
  flowFixture({ agents: [{ id: "a-hotel", name: "Hotel booking assistant" }] }),
  flowFixture({ id: "f-orders", name: "List orders", agents: [{ id: "a-hotel", name: "Hotel booking assistant" }] }),
  flowFixture({ id: "f-crm", apiId: "api-crm", api: { id: "api-crm", name: "CRM" }, agents: [{ id: "a-support", name: "Support triage" }] }),
];

function setup(apis = [shop, crm], options: Parameters<typeof mockApisApi>[1] = { flows }) {
  mockAgentsApi(agents);
  return mockApisApi(apis, options);
}

function rowOf(name: string) {
  return screen.getByRole("link", { name }).closest("tr") as HTMLElement;
}

async function renderCatalog() {
  const user = userEvent.setup({ delay: null });
  renderWithClient(<ApisContainer />);
  await screen.findByRole("table", { name: "APIs" });
  return user;
}

describe("API flows catalog", () => {
  beforeEach(() => {
    nav.push.mockReset();
  });

  it("lists each API with its base URL, secret names, flow count, agents and New flow", async () => {
    setup();
    await renderCatalog();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("API flows");
    const row = rowOf("Shop API");
    expect(within(row).getByRole("link", { name: "Shop API" })).toHaveAttribute("href", "/apis/api-shop");
    expect(within(row).getByText("Products and orders of the demo shop.")).toBeInTheDocument();
    expect(within(within(row).getByRole("list", { name: "Tags" })).getByText("nightly")).toBeInTheDocument();
    expect(within(row).getByText("https://shop.example.com/v1")).toBeInTheDocument();
    expect(within(row).getByRole("img", { name: "Secrets: apiKey, clientSecret" })).toBeInTheDocument();
    expect(within(row).getByText("2 flows")).toBeInTheDocument();
    expect(within(within(row).getByRole("list", { name: "Agents" })).getByText("Hotel booking assistant")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "New flow in Shop API" })).toHaveAttribute("href", "/apis/api-shop?new=flow");
    expect(within(row).getByRole("button", { name: "Run all flows of Shop API" })).toBeInTheDocument();

    const crmRow = rowOf("CRM");
    expect(within(crmRow).getByText("1 flow")).toBeInTheDocument();
    expect(within(crmRow).queryByRole("img", { name: /Secrets/ })).not.toBeInTheDocument();
  });

  it("filters by search (name, URL, description, tag), agent and tag", async () => {
    setup();
    const user = await renderCatalog();
    const search = screen.getByRole("searchbox", { name: "Search APIs" });

    for (const [query, expected] of [
      ["crm", ["CRM"]],
      ["localhost:8080", ["CRM"]],
      ["demo shop", ["Shop API"]],
      ["nightly", ["Shop API"]],
    ] as const) {
      await user.clear(search);
      await user.type(search, query);
      expect(screen.getAllByRole("link", { name: /^(Shop API|CRM)$/ }).map((link) => link.textContent)).toEqual(expected);
    }
    await user.clear(search);

    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "Support triage");
    expect(screen.getAllByRole("link", { name: /^(Shop API|CRM)$/ }).map((link) => link.textContent)).toEqual(["CRM"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "All agents");

    await user.selectOptions(screen.getByRole("combobox", { name: "Tag" }), "shop");
    expect(screen.getAllByRole("link", { name: /^(Shop API|CRM)$/ }).map((link) => link.textContent)).toEqual(["Shop API"]);

    await user.type(search, "zzz");
    expect(screen.getByText("No APIs match these filters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getAllByRole("link", { name: /^(Shop API|CRM)$/ })).toHaveLength(2);
  });

  it("pages the APIs twenty at a time and goes back to the first page when a filter changes", async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      apiFixture({ id: `api-${index}`, name: `API ${String(index).padStart(2, "0")}`, tags: index < 12 ? ["even"] : [] }),
    );
    setup(many, { flows: [] });
    const user = await renderCatalog();

    const pager = screen.getByRole("navigation", { name: "Pagination" });
    expect(pager).toHaveTextContent("1–20 of 25");
    expect(within(pager).getByRole("button", { name: "Previous page" })).toBeDisabled();
    await user.click(within(pager).getByRole("button", { name: "Next page" }));
    expect(pager).toHaveTextContent("21–25 of 25");
    expect(within(pager).getByRole("button", { name: "Next page" })).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox", { name: "Tag" }), "even");
    expect(pager).toHaveTextContent("1–12 of 12");
  });

  it("shows the empty state with New API, and a load error with a retry", async () => {
    setup([]);
    renderWithClient(<ApisContainer />);
    expect(await screen.findByRole("heading", { name: "No APIs yet" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "New API" }).length).toBeGreaterThan(0);
  });

  it("offers a retry when the APIs cannot be loaded", async () => {
    mockAgentsApi(agents);
    let calls = 0;
    server.use(
      http.get(apiUrl("/apis"), () => {
        calls += 1;
        return calls === 1 ? HttpResponse.json({ detail: "boom" }, { status: 500 }) : HttpResponse.json([crm]);
      }),
    );
    const user = userEvent.setup({ delay: null });
    renderWithClient(<ApisContainer />);
    expect(await screen.findByText("The APIs could not be loaded.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "CRM" })).toBeInTheDocument();
  });

  it("creates an API with its secrets and headers, then opens it", async () => {
    const state = setup();
    const user = await renderCatalog();

    await user.click(screen.getByRole("button", { name: "New API" }));
    const dialog = screen.getByRole("dialog", { name: "New API" });
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

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/apis/api-new-1"));
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
  });

  it("shows a taken name (409) on the name field and a refused base URL (422) on its field", async () => {
    const state = setup();
    const user = await renderCatalog();

    await user.click(screen.getByRole("button", { name: "New API" }));
    const dialog = screen.getByRole("dialog", { name: "New API" });
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
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("asks for the name and base URL before sending anything", async () => {
    const state = setup();
    const user = await renderCatalog();
    await user.click(screen.getByRole("button", { name: "New API" }));
    const dialog = screen.getByRole("dialog", { name: "New API" });
    await user.click(within(dialog).getByRole("button", { name: "Create API" }));
    expect(within(dialog).getByText("Enter a name.")).toBeInTheDocument();
    expect(within(dialog).getByText("Enter the base URL.")).toBeInTheDocument();
    expect(state.requests.filter((request) => request.method === "POST")).toEqual([]);
  });
});
