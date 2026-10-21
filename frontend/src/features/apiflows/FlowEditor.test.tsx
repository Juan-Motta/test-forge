import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentFixture, mockAgentsApi } from "@/features/agents/testing";
import { renderWithClient } from "@/test/render";
import { ApiContainer } from "./ApiContainer";
import { apiFixture, flowFixture, mockApisApi } from "./testing";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const shop = apiFixture({ variables: { tenant_id: "acme" } });
const concierge = { id: "a-concierge", name: "Concierge" };
const hotel = { id: "a-hotel", name: "Hotel booking assistant" };
const search = flowFixture({
  inputs: [{ name: "q", type: "text", description: "What to search", default: null, generate: "A product a guest wants" }],
  agents: [hotel],
});
search.steps[1].query = [
  { name: "q", value: "{{input.q}}" },
  { name: "lang", value: "en" },
];
search.steps[1].headers = [
  { name: "Authorization", value: "Bearer {{saved.token}}" },
  { name: "X-Key", value: "{{secret.apiKey}}" },
  { name: "X-Tenant", value: "{{var.tenant_id}}" },
  { name: "X-Api-Key", value: "{{var.apiKey}}" },
];
const other = flowFixture({ id: "f-orders", name: "List orders" });

function setup(flows = [search, other]) {
  mockAgentsApi([agentFixture({ ...hotel }), agentFixture({ ...concierge })]);
  return mockApisApi([shop], { flows, agents: [hotel, concierge] });
}

async function renderFlow(search = "flow=f-products") {
  nav.search = search;
  const user = userEvent.setup({ delay: null });
  const view = renderWithClient(<ApiContainer apiId="api-shop" />);
  await screen.findByRole("heading", { level: 1 });
  await screen.findByRole("region", { name: "Steps" });
  return { user, ...view };
}

const step = (n: number) => screen.getByRole("region", { name: `Step ${n}` });
const writes = (state: ReturnType<typeof setup>, method: string) =>
  state.requests.filter((request) => request.method === method && request.path.startsWith("/flows"));

describe("flow editor", () => {
  beforeEach(() => {
    nav.push.mockReset();
  });

  it("opens the flow selected in the rail, marked as the current page", async () => {
    setup();
    await renderFlow();

    const library = screen.getByRole("complementary", { name: "Flow library" });
    expect(within(library).getByRole("link", { name: /Search products/ })).toHaveAttribute("aria-current", "page");
    expect(within(library).getByRole("link", { name: /List orders/ })).not.toHaveAttribute("aria-current");
    expect(within(library).getByRole("link", { name: /List orders/ })).toHaveAttribute("href", "/apis/api-shop?flow=f-orders");

    expect(screen.getByRole("heading", { level: 2, name: /Search products/ })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Flow description" })).toHaveValue(flowFixture().description);
    expect(screen.getByRole("link", { name: "Run flow" })).toHaveAttribute("href", "/apis/api-shop?flow=f-products&run=new");
    expect(screen.getByText("Use {{input.name}}, {{var.name}} or {{saved.name}} in any value.")).toBeInTheDocument();
    expect(within(step(1)).getByRole("combobox", { name: "Method of step 1" })).toHaveValue("POST");
    expect(within(step(1)).getByRole("textbox", { name: "Path of step 1" })).toHaveValue("/auth/token");
    expect(within(step(1)).getByRole("textbox", { name: "JSON body of step 1" })).toHaveValue('{\n  "key": "{{secret.apiKey}}"\n}');
    expect(within(step(1)).getByRole("textbox", { name: "Step 1 saved path 1" })).toHaveValue("body.access_token");
    expect(within(step(1)).getByRole("textbox", { name: "Step 1 expected status 1" })).toHaveValue("200");
    // The arrow says what step 1 passes on.
    expect(screen.getByText("{{saved.token}}")).toBeInTheDocument();
  });

  it("shows where each value comes from, with a legend explained on hover", async () => {
    setup();
    await renderFlow();

    const legend = screen.getByRole("list", { name: "Value sources" });
    expect(within(legend).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Fixed",
      "Flow input",
      "Connection variable",
      "API secret",
      "From a step",
      "AI generated",
    ]);
    expect(within(legend).getByText("API secret")).toHaveAttribute("title", expect.stringContaining("{{secret.name}}"));
    expect(within(legend).getByText("Connection variable")).toHaveAttribute("title", expect.stringContaining("{{var.name}}"));

    const chip = (row: string) =>
      within(within(step(2)).getByRole("group", { name: row })).getByText(/^(Fixed|Flow input|Connection variable|API secret|From a step|AI generated)$/)
        .textContent;
    expect(chip("Step 2 query 1")).toBe("AI generated");
    expect(chip("Step 2 query 2")).toBe("Fixed");
    expect(chip("Step 2 header 1")).toBe("From a step");
    expect(chip("Step 2 header 2")).toBe("API secret");
    // {{var.x}}: a plain variable of the connection, or an API secret when x is one of its secrets.
    expect(chip("Step 2 header 3")).toBe("Connection variable");
    expect(chip("Step 2 header 4")).toBe("API secret");

    // Without "AI writes it from", the same value is a plain input.
    const user = userEvent.setup({ delay: null });
    await user.clear(screen.getByRole("textbox", { name: "AI writes input 1 from" }));
    expect(chip("Step 2 query 1")).toBe("Flow input");
  });

  it("saves the edits with a PATCH of the whole flow", async () => {
    const state = setup();
    const { user } = await renderFlow();

    await user.click(screen.getByRole("button", { name: "Rename the flow" }));
    const name = screen.getByRole("textbox", { name: "Rename the flow" });
    await user.clear(name);
    await user.type(name, "Find products{Enter}");
    await user.click(screen.getByRole("button", { name: "Add input" }));
    await user.type(screen.getByRole("textbox", { name: "Name of input 2" }), "limit");
    await user.selectOptions(screen.getByRole("combobox", { name: "Type of input 2" }), "number");
    await user.type(screen.getByRole("textbox", { name: "Default of input 2" }), "5");
    await user.click(within(step(2)).getByRole("button", { name: "Add query" }));
    await user.type(within(step(2)).getByRole("textbox", { name: "Step 2 query name 3" }), "limit");
    await user.type(within(step(2)).getByRole("textbox", { name: "Step 2 query value 3" }), "{{{{input.limit}}");
    await user.click(within(step(2)).getByRole("button", { name: "Add check" }));
    await user.selectOptions(within(step(2)).getByRole("combobox", { name: "Step 2 check type 1" }), "path");
    await user.type(within(step(2)).getByRole("textbox", { name: "Step 2 check path 1" }), "body.items.length");
    await user.selectOptions(within(step(2)).getByRole("combobox", { name: "Step 2 check operator 1" }), ">");
    await user.type(within(step(2)).getByRole("textbox", { name: "Step 2 check value 1" }), "0");
    await user.click(within(step(2)).getByRole("button", { name: "Add check" }));
    await user.selectOptions(within(step(2)).getByRole("combobox", { name: "Step 2 check type 2" }), "duration");
    await user.type(within(step(2)).getByRole("textbox", { name: "Step 2 check milliseconds 2" }), "1500");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved Find products.")).toBeInTheDocument();
    expect(writes(state, "PATCH")).toEqual([
      {
        method: "PATCH",
        path: "/flows/f-products",
        body: {
          name: "Find products",
          description: search.description,
          inputs: [...search.inputs, { name: "limit", type: "number", description: "", default: "5", generate: null }],
          steps: [
            search.steps[0],
            {
              ...search.steps[1],
              query: [...search.steps[1].query, { name: "limit", value: "{{input.limit}}" }],
              checks: [
                { type: "path", path: "body.items.length", op: ">", value: 0 },
                { type: "duration", maxMs: 1500 },
              ],
            },
          ],
          agentIds: ["a-hotel"],
        },
      },
    ]);
    // The rail shows the new name.
    const library = screen.getByRole("complementary", { name: "Flow library" });
    expect(await within(library).findByRole("link", { name: /Find products/ })).toBeInTheDocument();
  });

  it("writes a GraphQL body as a query and its variables, and checks that no errors came back", async () => {
    const state = setup();
    const { user } = await renderFlow();
    const second = within(step(2));

    await user.click(second.getByRole("radio", { name: "GraphQL" }));
    // A GraphQL call is a POST.
    expect(second.getByRole("combobox", { name: "Method of step 2" })).toHaveValue("POST");
    await user.click(second.getByRole("textbox", { name: "GraphQL query of step 2" }));
    await user.paste("query($q: String!) { products(q: $q) { id } }");
    await user.click(second.getByRole("textbox", { name: "GraphQL variables of step 2" }));
    await user.paste('{"q": "{{input.q}}"}');
    await user.click(second.getByRole("button", { name: "Add check" }));
    await user.selectOptions(second.getByRole("combobox", { name: "Step 2 check type 1" }), "path");
    await user.type(second.getByRole("textbox", { name: "Step 2 check path 1" }), "body.errors");
    await user.selectOptions(second.getByRole("combobox", { name: "Step 2 check operator 1" }), "absent");
    expect(second.queryByRole("textbox", { name: "Step 2 check value 1" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/^Saved /)).toBeInTheDocument();
    const [saved] = writes(state, "PATCH");
    expect((saved.body as { steps: unknown[] }).steps[1]).toEqual({
      ...search.steps[1],
      method: "POST",
      body: { query: "query($q: String!) { products(q: $q) { id } }", variables: { q: "{{input.q}}" } },
      checks: [{ type: "path", path: "body.errors", op: "absent", value: null }],
    });
  });

  it("refuses GraphQL variables that are not JSON before sending anything", async () => {
    const state = setup();
    const { user } = await renderFlow();
    const second = within(step(2));
    await user.click(second.getByRole("radio", { name: "GraphQL" }));
    await user.click(second.getByRole("textbox", { name: "GraphQL query of step 2" }));
    await user.paste("{ me { id } }");
    const variables = second.getByRole("textbox", { name: "GraphQL variables of step 2" });
    await user.click(variables);
    await user.paste("{ q: 1");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(variables).toHaveAttribute("aria-invalid", "true");
    expect(variables).toHaveAccessibleDescription("Enter valid JSON, or leave it empty for no body.");
    expect(writes(state, "PATCH")).toEqual([]);
  });

  it("asks for the GraphQL query instead of replacing the body with an empty one", async () => {
    const state = setup();
    const { user } = await renderFlow();
    await user.click(within(step(1)).getByRole("radio", { name: "GraphQL" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    const query = within(step(1)).getByRole("textbox", { name: "GraphQL query of step 1" });
    expect(query).toHaveAttribute("aria-invalid", "true");
    expect(query).toHaveAccessibleDescription("Write the GraphQL query, or switch the body back to JSON.");
    expect(writes(state, "PATCH")).toEqual([]);
  });

  it("refuses a body that is not JSON before sending anything", async () => {
    const state = setup();
    const { user } = await renderFlow();
    const body = within(step(1)).getByRole("textbox", { name: "JSON body of step 1" });
    await user.clear(body);
    await user.type(body, "{{ not json");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(body).toHaveAccessibleDescription("Enter valid JSON, or leave it empty for no body.");
    expect(body).toHaveAttribute("aria-invalid", "true");
    expect(writes(state, "PATCH")).toEqual([]);
  });

  it("shows the backend's 422 message on the row it names, and a taken name on the name", async () => {
    setup();
    const { user } = await renderFlow();

    // Step 1 no longer saves the token step 2 uses.
    await user.click(within(step(1)).getByRole("button", { name: "Remove step 1 saved value 1" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    const header = within(step(2)).getByRole("textbox", { name: "Step 2 header value 1" });
    await waitFor(() => expect(header).toHaveAccessibleDescription("no step saves 'token'"));
    expect(header).toHaveAttribute("aria-invalid", "true");
    expect(within(step(2)).getByRole("textbox", { name: "Step 2 header value 2" })).not.toHaveAttribute("aria-invalid");
    expect(screen.getByText("Check the highlighted fields.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename the flow" }));
    const name = screen.getByRole("textbox", { name: "Rename the flow" });
    await user.clear(name);
    await user.type(name, "List orders{Enter}");
    await user.click(within(step(1)).getByRole("button", { name: "Add saved value" }));
    await user.type(within(step(1)).getByRole("textbox", { name: "Step 1 saved name 1" }), "token");
    await user.type(within(step(1)).getByRole("textbox", { name: "Step 1 saved path 1" }), "body.access_token");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Flow name already in use")).toBeInTheDocument();
  });

  it("moves and removes steps", async () => {
    const state = setup();
    const { user } = await renderFlow();

    expect(within(step(1)).getByRole("button", { name: "Move step 1 up" })).toBeDisabled();
    expect(within(step(2)).getByRole("button", { name: "Move step 2 down" })).toBeDisabled();
    await user.click(within(step(2)).getByRole("button", { name: "Move step 2 up" }));
    expect(within(step(1)).getByRole("textbox", { name: "Path of step 1" })).toHaveValue("/products");
    expect(within(step(2)).getByRole("textbox", { name: "Path of step 2" })).toHaveValue("/auth/token");

    await user.click(screen.getByRole("button", { name: "Add step" }));
    expect(within(step(3)).getByRole("combobox", { name: "Method of step 3" })).toHaveValue("GET");
    expect(within(step(3)).getByRole("textbox", { name: "Path of step 3" })).toHaveValue("/");
    await user.click(within(step(1)).getByRole("button", { name: "Remove step 1" }));
    expect(screen.queryByRole("region", { name: "Step 3" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(state, "PATCH")).toHaveLength(1));
    const body = writes(state, "PATCH")[0].body as { steps: { method: string; path: string }[] };
    expect(body.steps.map((item) => `${item.method} ${item.path}`)).toEqual(["POST /auth/token", "GET /"]);
  });

  it("copies a step's cURL from the curl endpoint", async () => {
    const state = setup();
    const { user } = await renderFlow();

    await user.click(within(step(2)).getByRole("button", { name: "Copy cURL of step 2" }));
    expect(await screen.findByText("Copied the cURL of step 2.")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe("curl -X GET 'https://shop.example.com/v1/products'");
    expect(state.requests.filter((request) => request.path === "/flows/f-products/curl")).toHaveLength(1);
  });

  it("creates a new flow, then opens it", async () => {
    const state = setup();
    const { user } = await renderFlow("new=flow");

    expect(within(step(1)).getByRole("button", { name: "Copy cURL of step 1" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Run flow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete flow" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename the flow" }));
    await user.type(screen.getByRole("textbox", { name: "Rename the flow" }), "Health{Enter}");
    await user.type(screen.getByRole("textbox", { name: "Flow description" }), "Checks the API is up.");
    await user.clear(within(step(1)).getByRole("textbox", { name: "Path of step 1" }));
    await user.type(within(step(1)).getByRole("textbox", { name: "Path of step 1" }), "/health");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/apis/api-shop?flow=f-new-1"));
    expect(writes(state, "POST")).toEqual([
      {
        method: "POST",
        path: "/flows",
        body: {
          apiId: "api-shop",
          name: "Health",
          description: "Checks the API is up.",
          inputs: [],
          steps: [{ title: "", method: "GET", path: "/health", query: [], headers: [], body: null, saves: [], checks: [] }],
          agentIds: [],
        },
      },
    ]);
  });

  it("chooses the agents the flow is for", async () => {
    const state = setup();
    const { user } = await renderFlow();

    expect(within(screen.getByRole("list", { name: "Used by" })).getByText("Hotel booking assistant")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose agents" }));
    const picker = screen.getByRole("group", { name: "Choose agents" });
    expect(await within(picker).findByRole("checkbox", { name: "Hotel booking assistant" })).toBeChecked();
    await user.click(within(picker).getByRole("checkbox", { name: "Concierge" }));
    await user.click(within(picker).getByRole("checkbox", { name: "Hotel booking assistant" }));
    expect(within(screen.getByRole("list", { name: "Used by" })).getByText("Concierge")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(writes(state, "PATCH")).toHaveLength(1));
    expect((writes(state, "PATCH")[0].body as { agentIds: string[] }).agentIds).toEqual(["a-concierge"]);
    expect(state.flows[0].agents).toEqual([concierge]);
  });

  it("deletes the flow after confirming, then goes back to the API", async () => {
    const state = setup();
    const { user } = await renderFlow();

    await user.click(screen.getByRole("button", { name: "Delete flow" }));
    const dialog = screen.getByRole("dialog", { name: "Delete “Search products”?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete flow" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/apis/api-shop"));
    expect(state.flows.map((flow) => flow.id)).toEqual(["f-orders"]);
  });

  it("says when the selected flow does not exist", async () => {
    setup();
    nav.search = "flow=f-gone";
    renderWithClient(<ApiContainer apiId="api-shop" />);
    expect(await screen.findByText("Flow not found")).toBeInTheDocument();
  });
});
