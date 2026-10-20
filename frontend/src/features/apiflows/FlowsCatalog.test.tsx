import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw/http";
import { describe, expect, it } from "vitest";
import { renderWithClient } from "@/test/render";
import { apiUrl, server } from "@/test/server";
import { FlowsContainer } from "./FlowsContainer";
import { apiFixture, flowFixture, mockApisApi } from "./testing";

const shop = apiFixture();
const crm = apiFixture({ id: "api-crm", name: "CRM", tags: ["crm"] });
const hotel = { id: "a-hotel", name: "Hotel booking assistant" };
const support = { id: "a-support", name: "Support triage" };

const products = flowFixture({
  agents: [hotel],
  lastRun: { id: "run-9", status: "passed", createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(), durationMs: 900 },
});
const orders = flowFixture({ id: "f-orders", name: "List orders", description: "Pages through orders.", agents: [hotel] });
const contacts = flowFixture({
  id: "f-crm",
  apiId: "api-crm",
  api: { id: "api-crm", name: "CRM" },
  name: "Find contact",
  description: "Looks a contact up by email.",
  agents: [support],
  lastRun: { id: "run-7", status: "failed", createdAt: "2026-10-19T09:00:00Z", durationMs: 300 },
});

function rowOf(name: string): HTMLElement {
  const row = screen.getByRole("link", { name }).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

const flowNames = () =>
  within(screen.getByRole("table", { name: "Flows" }))
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("link")[0].textContent);

describe("Flows page", () => {
  it("lists every flow with its API, step methods, agents, last run and a Run action", async () => {
    mockApisApi([shop, crm], { flows: [products, orders, contacts] });
    renderWithClient(<FlowsContainer />);

    expect(await screen.findByRole("table", { name: "Flows" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Flows" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: /breadcrumb/i })).not.toBeInTheDocument();
    expect(flowNames()).toEqual(["Search products", "List orders", "Find contact"]);

    const row = rowOf("Search products");
    expect(within(row).getByRole("link", { name: "Search products" })).toHaveAttribute("href", "/apis/api-shop?flow=f-products");
    expect(within(row).getByText("Logs in with the API key, then searches the catalog.")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Shop API" })).toHaveAttribute("href", "/apis/api-shop");
    expect(within(within(row).getByRole("list", { name: "Steps" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "POST",
      "GET",
    ]);
    expect(within(within(row).getByRole("list", { name: "Agents" })).getByText("Hotel booking assistant")).toBeInTheDocument();
    const last = within(row).getByRole("link", { name: /^Last run of Search products: Passed, / });
    expect(last).toHaveAttribute("href", "/apis/api-shop?flow=f-products&run=run-9");
    expect(last).toHaveTextContent(/Passed.*2 hours ago/);
    expect(within(row).getByRole("link", { name: "Run Search products" })).toHaveAttribute(
      "href",
      "/apis/api-shop?flow=f-products&run=new",
    );

    expect(within(rowOf("Find contact")).getByRole("link", { name: /^Last run of Find contact: Failed/ })).toHaveAttribute(
      "href",
      "/apis/api-crm?flow=f-crm&run=run-7",
    );
    expect(within(rowOf("List orders")).getByText("Never run")).toBeInTheDocument();
    expect(within(rowOf("List orders")).queryByRole("link", { name: /^Last run/ })).not.toBeInTheDocument();
  });

  it("searches by name, description or API, and filters by API and agent", async () => {
    mockApisApi([shop, crm], { flows: [products, orders, contacts] });
    renderWithClient(<FlowsContainer />);
    await screen.findByRole("table", { name: "Flows" });

    const search = screen.getByRole("searchbox", { name: "Search flows" });
    await userEvent.type(search, "orders");
    expect(flowNames()).toEqual(["List orders"]);
    await userEvent.clear(search);
    await userEvent.type(search, "crm");
    expect(flowNames()).toEqual(["Find contact"]);
    await userEvent.clear(search);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "API" }), "Shop API");
    expect(flowNames()).toEqual(["Search products", "List orders"]);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "API" }), "All APIs");

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Agent" }), "Support triage");
    expect(flowNames()).toEqual(["Find contact"]);

    await userEvent.type(search, "orders");
    expect(screen.getByText("No flows match these filters.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(flowNames()).toHaveLength(3);
    expect(search).toHaveValue("");
  });

  it("shows 20 flows per page", async () => {
    const many = Array.from({ length: 23 }, (_, n) => flowFixture({ id: `f-${n}`, name: `Flow ${String(n + 1).padStart(2, "0")}` }));
    mockApisApi([shop], { flows: many });
    renderWithClient(<FlowsContainer />);
    await screen.findByRole("table", { name: "Flows" });

    expect(flowNames()).toHaveLength(20);
    expect(screen.getByText("1–20 of 23")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Next page" }));

    expect(flowNames()).toEqual(["Flow 21", "Flow 22", "Flow 23"]);
    expect(screen.getByText("21–23 of 23")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("points to the APIs when there is no flow yet", async () => {
    mockApisApi([shop]);
    renderWithClient(<FlowsContainer />);

    expect(await screen.findByText("No flows yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to API connections" })).toHaveAttribute("href", "/apis");
  });

  it("says when the flows could not be loaded and retries", async () => {
    let fail = true;
    server.use(
      http.get(apiUrl("/flows"), () =>
        fail ? HttpResponse.json({ detail: "boom" }, { status: 500 }) : HttpResponse.json([products]),
      ),
    );
    renderWithClient(<FlowsContainer />);

    expect(await screen.findByText("The flows could not be loaded.")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(flowNames()).toEqual(["Search products"]));
  });
});
