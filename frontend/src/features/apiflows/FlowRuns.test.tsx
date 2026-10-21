import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockAgentsApi } from "@/features/agents/testing";
import { renderWithClient } from "@/test/render";
import { ApiContainer } from "./ApiContainer";
import { apiFixture, flowFixture, mockApisApi, runFixture } from "./testing";
import type { FlowRun } from "./types";

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace, back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const shop = apiFixture();
const search = flowFixture({
  inputs: [
    { name: "q", type: "text", description: "What to search", default: "shoes", generate: null },
    { name: "limit", type: "number", description: "", default: null, generate: null },
    { name: "persona", type: "text", description: "", default: null, generate: "A shopper" },
  ],
});
const orders = flowFixture({ id: "f-orders", name: "List orders", inputs: [] });
const stored = runFixture();
const secrets = { "api-shop": { apiKey: "sk-live-1234567890" } };

type Options = Parameters<typeof mockApisApi>[1];
function setup(options: Options = {}) {
  mockAgentsApi([]);
  return mockApisApi([shop], { flows: [search, orders], secrets, runs: [stored], ...options });
}

async function renderAt(query: string) {
  nav.search = query;
  const user = userEvent.setup({ delay: null });
  const view = renderWithClient(<ApiContainer apiId="api-shop" />);
  await screen.findByRole("heading", { level: 1 });
  return { user, ...view };
}

const secretReads = (state: ReturnType<typeof setup>) => state.requests.filter((request) => request.path === "/apis/api-shop/secrets");

describe("run form", () => {
  beforeEach(() => nav.push.mockReset());

  it("prefills defaults, hints AI inputs, posts the typed inputs, then opens the new run", async () => {
    const state = setup();
    const { user } = await renderAt("flow=f-products&run=new");

    const form = await screen.findByRole("form", { name: "Run Search products" });
    expect(within(form).getByLabelText("q")).toHaveValue("shoes");
    expect(within(form).getByLabelText("persona")).toHaveValue("");
    expect(within(form).getByText("Leave empty: AI writes it")).toBeInTheDocument();
    // The rail and the API header stay.
    expect(screen.getByRole("complementary", { name: "Flow library" })).toBeInTheDocument();

    await user.type(within(form).getByLabelText("limit"), "5");
    await user.click(within(form).getByRole("button", { name: "Run flow" }));

    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/apis/api-shop?flow=f-products&run=run-new-1"));
    const post = state.requests.find((request) => request.method === "POST" && request.path === "/flows/f-products/runs");
    expect(post?.body).toEqual({ inputs: { q: "shoes", limit: 5 } });
  });

  it("disables Run flow and shows a spinner while it runs", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    setup({
      onRun: async (flow) => {
        await gate;
        return runFixture({ flowId: flow.id });
      },
    });
    const { user } = await renderAt("flow=f-products&run=new");
    await user.click(await screen.findByRole("button", { name: "Run flow" }));

    expect(screen.getByRole("button", { name: "Run flow" })).toBeDisabled();
    expect(screen.getByText(/Running the flow/)).toBeInTheDocument();
    release();
    await waitFor(() => expect(nav.push).toHaveBeenCalled());
  });

  it("puts a 422 beside its input", async () => {
    setup({
      onRun: () =>
        HttpResponse.json(
          { detail: [{ type: "value_error", loc: ["body", "inputs", "limit"], msg: "Value error, enter a number" }] },
          { status: 422 },
        ),
    });
    const { user } = await renderAt("flow=f-products&run=new");
    await user.click(await screen.findByRole("button", { name: "Run flow" }));

    const limit = await screen.findByLabelText("limit");
    await waitFor(() => expect(limit).toHaveAttribute("aria-invalid", "true"));
    expect(limit).toHaveAccessibleDescription(/Value error, enter a number/);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("shows a 502 as an alert", async () => {
    setup({
      onRun: () => HttpResponse.json({ detail: "AI could not write the inputs (no chat connection)" }, { status: 502 }),
    });
    const { user } = await renderAt("flow=f-products&run=new");
    await user.click(await screen.findByRole("button", { name: "Run flow" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("AI could not write the inputs");
    expect(alert).toHaveTextContent("no chat connection");
  });
});

describe("run view", () => {
  beforeEach(() => nav.push.mockReset());

  async function renderRun(state = setup()) {
    const view = await renderAt("flow=f-products&run=run-1");
    await screen.findByRole("heading", { level: 2, name: "Run of Search products" });
    return { state, ...view };
  }

  it("heads the run with its status, inputs and links, and selects the first failed step", async () => {
    await renderRun();

    expect(screen.getByText("Failed · 2.4 s")).toBeInTheDocument();
    const inputs = screen.getByRole("list", { name: "Inputs used" });
    expect(within(inputs).getByText("shoes")).toBeInTheDocument();
    expect(within(inputs).getByText("given")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit flow" })).toHaveAttribute("href", "/apis/api-shop?flow=f-products");
    expect(screen.getByRole("link", { name: "Run again" })).toHaveAttribute("href", "/apis/api-shop?flow=f-products&run=new");

    const strip = screen.getByRole("list", { name: "Steps of the run" });
    const first = within(strip).getByRole("button", { name: "Step 1: Get a token, Passed" });
    const second = within(strip).getByRole("button", { name: "Step 2: Search, Failed" });
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(first).toHaveAttribute("aria-pressed", "false");
    expect(second).toHaveTextContent("/v1/products?q=shoes");
    expect(second).toHaveTextContent("500 · 80 ms");

    const details = screen.getByRole("region", { name: "Step 2: Search" });
    expect(within(details).getByText("Internal error")).toBeInTheDocument();
    const checks = within(details).getByRole("region", { name: "Checks" });
    expect(checks).toHaveTextContent("status == 200");
    expect(checks).toHaveTextContent("actual: 500");
  });

  it("masks secrets, reveals them with the eye only on click, and copies what is shown", async () => {
    const { state, user } = await renderRun();
    await user.click(screen.getByRole("button", { name: "Step 1: Get a token, Passed" }));

    const details = screen.getByRole("region", { name: "Step 1: Get a token" });
    const request = within(details).getByRole("region", { name: "Request" });
    expect(request).toHaveTextContent("apiKey ••••7890");
    expect(request).not.toHaveTextContent("sk-live-1234567890");
    expect(secretReads(state)).toHaveLength(0);

    // The response body is pretty JSON; the saved values are listed.
    const response = within(details).getByRole("region", { name: "Response" });
    expect(within(response).getByLabelText("Response").textContent).toBe('{\n  "access_token": "tok-1",\n  "expires_in": 3600\n}');
    expect(within(response).getByText("200")).toBeInTheDocument();
    expect(within(details).getByRole("region", { name: "Saved values" })).toHaveTextContent("tok-1");

    await user.click(within(request).getByRole("button", { name: "Copy cURL" }));
    expect(await navigator.clipboard.readText()).toContain("••••7890");
    expect(state.requests.filter((r) => r.path === "/flow-runs/run-1/steps/0/curl").map((r) => r.query ?? "")).toEqual([""]);

    await user.click(within(request).getByRole("button", { name: "Show secrets" }));
    await waitFor(() => expect(request).toHaveTextContent("sk-live-1234567890"));
    expect(secretReads(state)).toHaveLength(1);
    expect(within(request).getByRole("button", { name: "Hide secrets" })).toHaveAttribute("aria-pressed", "true");

    await user.click(within(request).getByRole("button", { name: "Copy cURL" }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toContain("sk-live-1234567890"));
    expect(state.requests.filter((r) => r.path === "/flow-runs/run-1/steps/0/curl").map((r) => r.query ?? "")).toEqual(["", "?reveal=true"]);

    await user.click(within(request).getByRole("button", { name: "Hide secrets" }));
    expect(request).not.toHaveTextContent("sk-live-1234567890");
    await user.click(within(request).getByRole("button", { name: "Copy cURL" }));
    await waitFor(() =>
      expect(state.requests.filter((r) => r.path === "/flow-runs/run-1/steps/0/curl").map((r) => r.query ?? "")).toEqual([
        "",
        "?reveal=true",
        "",
      ]),
    );
  });

  it("copies the response with one icon and searches it, marking every match", async () => {
    const { user } = await renderRun();
    await user.click(screen.getByRole("button", { name: "Step 1: Get a token, Passed" }));
    const response = within(screen.getByRole("region", { name: "Step 1: Get a token" })).getByRole("region", { name: "Response" });

    await user.click(within(response).getByRole("button", { name: "Copy response" }));
    expect(await navigator.clipboard.readText()).toBe('{\n  "access_token": "tok-1",\n  "expires_in": 3600\n}');

    await user.type(within(response).getByRole("searchbox", { name: "Search the response" }), "TOK");
    expect(within(response).getByText("2 matches")).toHaveAttribute("role", "status");
    const body = within(response).getByLabelText("Response");
    expect(Array.from(body.querySelectorAll("mark[data-match]")).map((mark) => mark.textContent)).toEqual(["tok", "tok"]);
    // The body text itself is unchanged by the marks.
    expect(body.textContent).toBe('{\n  "access_token": "tok-1",\n  "expires_in": 3600\n}');
  });

  it("draws the steps as boxes joined by a line carrying the values passed on", async () => {
    await renderRun();
    const steps = screen.getByRole("list", { name: "Steps of the run" });
    expect(within(steps).getByRole("button", { name: "Step 1: Get a token, Passed" })).toHaveTextContent("saves token");
    const line = within(steps).getByRole("listitem", { name: "Values passed to step 2" });
    const chip = within(line).getByRole("listitem");
    expect(chip).toHaveTextContent("token= tok-1");
    expect(chip).toHaveAttribute("title", "From step 1 (body.access_token), sent as header Authorization");
  });

  it("says when the run does not exist", async () => {
    setup();
    await renderAt("flow=f-products&run=missing");
    expect(await screen.findByText("Run not found")).toBeInTheDocument();
  });
});

describe("recent runs", () => {
  it("lists the flow's latest runs in the editor, each linking to its run", async () => {
    const passed: FlowRun = runFixture({ id: "run-2", status: "passed", durationMs: 900 });
    const state = setup({ runs: [passed, stored] });
    await renderAt("flow=f-products");

    const recent = await screen.findByRole("region", { name: "Recent runs" });
    const links = await within(recent).findAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/apis/api-shop?flow=f-products&run=run-2",
      "/apis/api-shop?flow=f-products&run=run-1",
    ]);
    expect(links[0]).toHaveTextContent("Passed");
    expect(links[0]).toHaveTextContent("900 ms");
    expect(links[1]).toHaveTextContent("Failed");
    expect(state.requests.find((r) => r.path === "/flows/f-products/runs")?.query).toBe("?limit=10");
  });
});

describe("Run all", () => {
  beforeEach(() => nav.push.mockReset());

  const outcomes = (flow: { id: string }) => {
    if (flow.id === "f-products") return runFixture({ status: "passed" });
    if (flow.id === "f-orders") return runFixture({ status: "failed" });
    if (flow.id === "f-needs")
      return HttpResponse.json({ detail: [{ type: "missing", loc: ["body", "inputs", "q"], msg: "Field required" }] }, { status: 422 });
    return HttpResponse.json({ detail: "AI could not write the inputs (no connection)" }, { status: 502 });
  };
  const needs = flowFixture({ id: "f-needs", name: "Needs a query" });
  const ai = flowFixture({ id: "f-ai", name: "Writes a persona" });

  it("asks first, then runs each flow with no inputs and lists how each ended", async () => {
    const state = setup({ onRun: outcomes, flows: [search, orders, needs, ai] });
    const { user } = await renderAt("");

    await user.click(screen.getByRole("button", { name: "Run all" }));
    const dialog = await screen.findByRole("dialog", { name: "Run 4 flows" });
    expect(state.requests.filter((r) => r.method === "POST")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Run 4 flows" }));

    const results = await screen.findByRole("list", { name: "Results" });
    expect(await screen.findByText("Done: 1 passed of 4.")).toBeInTheDocument();
    const rows = within(results).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Passed");
    expect(within(rows[0]).getByRole("link", { name: "Search products" })).toHaveAttribute(
      "href",
      "/apis/api-shop?flow=f-products&run=run-new-1",
    );
    expect(rows[1]).toHaveTextContent("Failed");
    expect(rows[2]).toHaveTextContent("Needs inputs");
    expect(within(rows[2]).queryByRole("link")).not.toBeInTheDocument();
    expect(rows[3]).toHaveTextContent("AI unavailable");

    const posts = state.requests.filter((r) => r.method === "POST");
    expect(posts.map((r) => r.path)).toEqual([
      "/flows/f-products/runs",
      "/flows/f-orders/runs",
      "/flows/f-needs/runs",
      "/flows/f-ai/runs",
    ]);
    expect(posts.every((r) => JSON.stringify(r.body) === '{"inputs":{}}')).toBe(true);
  });
});
