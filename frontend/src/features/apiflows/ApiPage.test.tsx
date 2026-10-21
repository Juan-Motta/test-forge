import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { ApiContainer } from "./ApiContainer";
import { apiFixture, flowFixture, mockApisApi } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const shop = apiFixture({
  tags: ["shop"],
  secrets: [
    { name: "apiKey", hint: "••••7890" },
    { name: "clientSecret", hint: "••••" },
  ],
});
const crm = apiFixture({ id: "api-crm", name: "CRM", secrets: [] });
const search = flowFixture();
const deleteOrder = flowFixture({
  id: "f-delete",
  name: "Cancel an order",
  steps: [{ ...flowFixture().steps[1], method: "DELETE", path: "/orders/1" }, { ...flowFixture().steps[1], method: "PATCH" }],
});
const elsewhere = flowFixture({ id: "f-crm", apiId: "api-crm", api: { id: "api-crm", name: "CRM" }, name: "Find a customer" });
const secrets = { "api-shop": { apiKey: "sk-live-1234567890", clientSecret: "abc" } };

function setup(flows = [search, deleteOrder, elsewhere]) {
  return mockApisApi([shop, crm], { flows, secrets });
}

async function renderApi(id = "api-shop") {
  const user = userEvent.setup({ delay: null });
  const view = renderWithClient(<ApiContainer apiId={id} />);
  await screen.findByRole("heading", { level: 1 });
  return { user, ...view };
}

const secretReads = (state: ReturnType<typeof setup>) =>
  state.requests.filter((request) => request.path === "/apis/api-shop/secrets");
const patches = (state: ReturnType<typeof setup>) =>
  state.requests.filter((request) => request.method === "PATCH").map((request) => request.body);

describe("API page", () => {
  beforeEach(() => {
    nav.push.mockReset();
  });

  it("heads the page with the name, description, base URL, masked secrets and tags; its flows in the sidebar", async () => {
    const state = setup();
    await renderApi();

    expect(screen.getByRole("link", { name: "API flows" })).toHaveAttribute("href", "/apis?api=api-shop");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Shop API");
    expect(screen.getByRole("button", { name: "Rename the API Shop API" })).toBeInTheDocument();
    expect(screen.getByText("Products and orders of the demo shop.")).toBeInTheDocument();
    const connection = screen.getByRole("list", { name: "Connection" });
    expect(within(connection).getByText("https://shop.example.com/v1")).toBeInTheDocument();
    expect(within(connection).getByText("••••7890")).toBeInTheDocument();
    expect(within(connection).getByRole("button", { name: "Show apiKey" })).toHaveAttribute("aria-pressed", "false");
    expect(within(connection).getByRole("button", { name: "Show clientSecret" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add tag" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "API tags" })).getByText("shop")).toBeInTheDocument();

    const library = screen.getByRole("complementary", { name: "Flow library" });
    const first = await within(library).findByRole("link", { name: /Search products/ });
    expect(first).toHaveAttribute("href", "/apis/api-shop?flow=f-products");
    expect(within(first).getByText("POST")).toBeInTheDocument();
    expect(within(first).getByText("GET")).toBeInTheDocument();
    const second = within(library).getByRole("link", { name: /Cancel an order/ });
    expect(within(second).getByText("DELETE")).toBeInTheDocument();
    expect(within(second).getByText("PATCH")).toBeInTheDocument();
    expect(within(library).queryByText("Find a customer")).not.toBeInTheDocument();
    expect(within(library).getByRole("link", { name: "New flow" })).toHaveAttribute("href", "/apis/api-shop?new=flow");
    expect(state.requests.some((request) => request.method === "GET" && request.path === "/flows")).toBe(true);

    await filterRail(library);
    expect(screen.getByRole("heading", { name: "Select a flow" })).toBeInTheDocument();
    // Nothing asked for the values on the way in.
    expect(secretReads(state)).toEqual([]);
  });

  it("reveals a secret only when its eye is clicked, hides it again, and forgets it on leaving", async () => {
    const state = setup();
    const { user, unmount } = await renderApi();
    const connection = screen.getByRole("list", { name: "Connection" });
    expect(secretReads(state)).toEqual([]);

    await user.click(within(connection).getByRole("button", { name: "Show apiKey" }));
    expect(await within(connection).findByText("sk-live-1234567890")).toBeInTheDocument();
    expect(secretReads(state)).toHaveLength(1);
    expect(within(connection).getByRole("button", { name: "Hide apiKey" })).toHaveAttribute("aria-pressed", "true");
    // The other one stays masked.
    expect(within(connection).queryByText("abc")).not.toBeInTheDocument();

    await user.click(within(connection).getByRole("button", { name: "Hide apiKey" }));
    expect(within(connection).queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    expect(within(connection).getByText("••••7890")).toBeInTheDocument();
    expect(secretReads(state)).toHaveLength(1);

    await user.click(within(connection).getByRole("button", { name: "Show apiKey" }));
    expect(await within(connection).findByText("sk-live-1234567890")).toBeInTheDocument();
    expect(secretReads(state)).toHaveLength(2);

    unmount();
    renderWithClient(<ApiContainer apiId="api-shop" />);
    const again = await screen.findByRole("list", { name: "Connection" });
    expect(within(again).getByRole("button", { name: "Show apiKey" })).toBeInTheDocument();
    expect(screen.queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    expect(secretReads(state)).toHaveLength(2);
  });

  it("edits the name, the description and the tags in place", async () => {
    const state = setup();
    const { user } = await renderApi();

    await user.click(screen.getByRole("button", { name: "Rename the API Shop API" }));
    const name = screen.getByRole("textbox", { name: "Rename the API Shop API" });
    await user.clear(name);
    await user.type(name, "Shop{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Shop"));

    await user.click(screen.getByRole("button", { name: "Edit the description" }));
    const description = screen.getByRole("textbox", { name: "Edit the description" });
    await user.clear(description);
    await user.type(description, "The demo shop.");
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit the description" })).not.toBeInTheDocument());
    expect(screen.getByText("The demo shop.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add tag" }));
    await user.type(screen.getByRole("textbox", { name: "New tag" }), "payments{Enter}");
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Remove the tag shop" }));
    await waitFor(() => expect(patches(state)).toHaveLength(4));

    expect(patches(state)).toEqual([
      { name: "Shop" },
      { description: "The demo shop." },
      { tags: ["shop", "payments"] },
      { tags: ["payments"] },
    ]);
  });

  it("says when the new name is taken", async () => {
    setup();
    const { user } = await renderApi();
    await user.click(screen.getByRole("button", { name: "Rename the API Shop API" }));
    const name = screen.getByRole("textbox", { name: "Rename the API Shop API" });
    await user.clear(name);
    await user.type(name, "CRM{Enter}");
    expect(await screen.findByText("An API with this name already exists. Try another.")).toBeInTheDocument();
  });

  it("edits the connection, sending only the secrets typed or removed", async () => {
    const state = setup();
    const { user } = await renderApi();

    await user.click(screen.getByRole("button", { name: "Edit connection" }));
    const dialog = screen.getByRole("dialog", { name: "Edit connection" });
    const baseUrl = within(dialog).getByRole("textbox", { name: "Base URL" });
    expect(baseUrl).toHaveValue("https://shop.example.com/v1");
    // No header sends them, so they are secret variables, collapsed until opened.
    const advanced = within(dialog).getByRole("button", { name: /Secret variables \(advanced\)/ });
    expect(advanced).toHaveAttribute("aria-expanded", "false");
    expect(within(dialog).queryByLabelText("New value of apiKey")).not.toBeInTheDocument();
    await user.click(advanced);
    // Stored secrets start empty: their values never come back to the form.
    const apiKey = within(dialog).getByLabelText("New value of apiKey");
    expect(apiKey).toHaveValue("");
    expect(apiKey).toHaveAttribute("type", "password");
    expect(within(dialog).getByLabelText("New value of clientSecret")).toHaveValue("");

    await user.clear(baseUrl);
    await user.type(baseUrl, "https://shop.example.com/v2");
    await user.type(apiKey, "sk-new-0000");
    await user.click(within(dialog).getByRole("button", { name: "Remove the secret clientSecret" }));
    await user.click(within(dialog).getByRole("button", { name: "Add secret" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Secret name 1" }), "webhook");
    await user.type(within(dialog).getByLabelText("Secret value 1"), "wh-1");
    await user.click(within(dialog).getByRole("button", { name: "Save connection" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit connection" })).not.toBeInTheDocument());
    expect(patches(state)).toEqual([
      { baseUrl: "https://shop.example.com/v2", secrets: { clientSecret: null, apiKey: "sk-new-0000", webhook: "wh-1" } },
    ]);
    const connection = screen.getByRole("list", { name: "Connection" });
    expect(await within(connection).findByText("https://shop.example.com/v2")).toBeInTheDocument();
    expect(within(connection).getByRole("button", { name: "Show webhook" })).toBeInTheDocument();
    expect(within(connection).queryByRole("button", { name: "Show clientSecret" })).not.toBeInTheDocument();
    expect(secretReads(state)).toEqual([]);
  });

  it("edits a secret header in the dialog like on the APIs page", async () => {
    const keyed = apiFixture({
      headers: [
        { name: "Accept", value: "application/json" },
        { name: "x-api-key", value: "{{secret.x_api_key}}" },
      ],
      secrets: [{ name: "x_api_key", hint: "••••7890" }],
    });
    const state = mockApisApi([keyed], { flows: [], secrets: { "api-shop": { x_api_key: "sk-live-1234567890" } } });
    const { user } = await renderApi();

    await user.click(screen.getByRole("button", { name: "Edit connection" }));
    const dialog = screen.getByRole("dialog", { name: "Edit connection" });
    expect(within(dialog).getByRole("textbox", { name: "Header name 2" })).toHaveValue("x-api-key");
    expect(within(dialog).getByRole("switch", { name: "Keep the header x-api-key secret" })).toBeChecked();
    expect(within(dialog).getByText("••••7890")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("New value of x_api_key")).toHaveAttribute("type", "password");
    expect(secretReads(state)).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Show x_api_key" }));
    expect(await within(dialog).findByText("sk-live-1234567890")).toBeInTheDocument();
    expect(secretReads(state)).toHaveLength(1);

    // Turned plain, with a new secret header beside it.
    await user.click(within(dialog).getByRole("switch", { name: "Keep the header x-api-key secret" }));
    expect(within(dialog).queryByText("sk-live-1234567890")).not.toBeInTheDocument();
    await user.type(within(dialog).getByRole("textbox", { name: "Header value 2" }), "plain-key");
    await user.click(within(dialog).getByRole("button", { name: "Add header" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Header name 3" }), "X-Client-Id");
    await user.click(within(dialog).getByRole("switch", { name: "Keep the header X-Client-Id secret" }));
    await user.type(within(dialog).getByLabelText("Header value 3"), "cid");
    await user.click(within(dialog).getByRole("button", { name: "Save connection" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit connection" })).not.toBeInTheDocument());
    expect(patches(state)).toEqual([
      {
        headers: [
          { name: "Accept", value: "application/json" },
          { name: "x-api-key", value: "plain-key" },
          { name: "X-Client-Id", value: "{{secret.x_client_id}}" },
        ],
        secrets: { x_api_key: null, x_client_id: "cid" },
      },
    ]);
    expect(secretReads(state)).toHaveLength(1);
  });

  it("removes a secret header with its secret from the dialog", async () => {
    const keyed = apiFixture({
      headers: [{ name: "x-api-key", value: "{{secret.x_api_key}}" }],
      secrets: [{ name: "x_api_key", hint: "••••7890" }],
    });
    const state = mockApisApi([keyed], { flows: [] });
    const { user } = await renderApi();

    await user.click(screen.getByRole("button", { name: "Edit connection" }));
    const dialog = screen.getByRole("dialog", { name: "Edit connection" });
    await user.click(within(dialog).getByRole("button", { name: "Remove the header x-api-key" }));
    await user.click(within(dialog).getByRole("button", { name: "Save connection" }));

    await waitFor(() => expect(patches(state)).toHaveLength(1));
    expect(patches(state)).toEqual([{ headers: [], secrets: { x_api_key: null } }]);
  });

  it("sends headers only when they changed, and nothing when nothing changed", async () => {
    const state = setup();
    const { user } = await renderApi();

    await user.click(screen.getByRole("button", { name: "Edit connection" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(patches(state)).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Edit connection" }));
    const dialog = screen.getByRole("dialog", { name: "Edit connection" });
    await user.click(within(dialog).getByRole("button", { name: "Add header" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Header name 2" }), "X-Shop");
    await user.type(within(dialog).getByRole("textbox", { name: "Header value 2" }), "demo");
    await user.click(within(dialog).getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(patches(state)).toHaveLength(1));
    expect(patches(state)).toEqual([
      {
        headers: [
          { name: "Accept", value: "application/json" },
          { name: "X-Shop", value: "demo" },
        ],
      },
    ]);
  });

  it("deletes an API without flows after confirming, then goes back to the catalog", async () => {
    const state = setup([elsewhere]);
    const { user } = await renderApi();

    await user.click(screen.getByRole("button", { name: "Delete Shop API" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Shop API”?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete API" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/apis"));
    expect(state.items.map((item) => item.id)).toEqual(["api-crm"]);
  });

  it("offers no delete while the API holds flows", async () => {
    setup();
    await renderApi();
    expect(screen.queryByRole("button", { name: "Delete Shop API" })).not.toBeInTheDocument();
  });

  it("says when the API does not exist", async () => {
    setup();
    renderWithClient(<ApiContainer apiId="api-gone" />);
    expect(await screen.findByText("API not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to API flows" })).toHaveAttribute("href", "/apis");
  });
});

/** Filters the rail down to one flow and back. */
async function filterRail(library: HTMLElement) {
  const user = userEvent.setup({ delay: null });
  const filter = within(library).getByRole("searchbox", { name: "Filter flows" });
  await user.type(filter, "cancel");
  expect(within(library).queryByText("Search products")).not.toBeInTheDocument();
  expect(within(library).getByText("Cancel an order")).toBeInTheDocument();
  await user.clear(filter);
}
