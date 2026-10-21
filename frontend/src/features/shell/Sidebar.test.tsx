import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { navGroupStorageKey } from "./nav-group-preference";
import { activeHref, NAV_PRIMARY, NAV_SECONDARY, navItems } from "./navigation";
import { Sidebar } from "./Sidebar";

const ALL = [...navItems(NAV_PRIMARY), ...NAV_SECONDARY];

const ADA = { displayName: "Ada Lovelace", email: "ada@example.com" };

function renderSidebar(pathname: string, overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  render(
    <Sidebar
      pathname={pathname}
      user={ADA}
      onSignOut={vi.fn()}
      signingOut={false}
      {...overrides}
    />,
  );
  return within(screen.getByRole("navigation", { name: "Primary" }));
}

describe("activeHref", () => {
  it.each([
    ["/", "/"],
    ["/runs", "/runs"],
    ["/runs/R-2291", "/runs"],
    ["/runs/R-2291/report", "/runs"],
    ["/flow-runs", "/flow-runs"],
    ["/settings", "/settings"],
    ["/settings/connections", "/settings"],
    ["/settings/connections/abc", "/settings"],
    ["/settings/api-keys", "/settings"],
    ["/settings/pricing", "/settings"],
    ["/agents", "/agents"],
    ["/scenarios/s-1", "/scenarios"],
    ["/apis/api-shop", "/apis"],
    ["/flows", "/flows"],
    ["/flows/f-1", "/flows"],
    ["/unknown", null],
  ])("%s -> %s", (pathname, expected) => {
    expect(activeHref(pathname, ALL)).toBe(expected);
  });
});

describe("Sidebar", () => {
  beforeEach(() => window.localStorage.clear());

  it("leaves the theme and language switches to Settings", () => {
    renderSidebar("/");
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Language" })).not.toBeInTheDocument();
  });

  it("lists the main sections, the Agents and API groups with their pages, and Settings", () => {
    const nav = renderSidebar("/");
    const hrefs = nav.getAllByRole("link").map((link) => link.getAttribute("href"));

    expect(hrefs.slice(0, 9)).toEqual([
      "/",
      "/live",
      "/agents",
      "/scenarios",
      "/runs",
      "/apis",
      "/flows",
      "/flow-runs",
      "/settings",
    ]);
    // Runs & reports is no longer a section of its own.
    expect(nav.queryByRole("link", { name: "Runs & reports" })).not.toBeInTheDocument();
    const agents = within(nav.getByRole("list", { name: "Agents" }));
    expect(agents.getAllByRole("link").map((link) => link.textContent)).toEqual(["Connections", "Scenarios", "Runs"]);
    const api = within(nav.getByRole("list", { name: "API" }));
    expect(api.getAllByRole("link").map((link) => link.textContent)).toEqual(["Connections", "Flows", "Runs"]);
    expect(nav.queryByRole("link", { name: "API keys" })).not.toBeInTheDocument();
    expect(hrefs).not.toContain("/settings/connections");
  });

  it("marks only the current section with aria-current=page", () => {
    const nav = renderSidebar("/live");

    expect(nav.getByRole("link", { name: "Live sessions" })).toHaveAttribute("aria-current", "page");
    for (const link of nav.getAllByRole("link")) {
      if (link.getAttribute("href") !== "/live") expect(link).not.toHaveAttribute("aria-current");
    }
  });

  it.each([
    ["/agents", "Agents", "/agents"],
    ["/scenarios", "Agents", "/scenarios"],
    ["/scenarios/s-1/edit", "Agents", "/scenarios"],
    ["/apis", "API", "/apis"],
    ["/apis/api-shop", "API", "/apis"],
    ["/flows", "API", "/flows"],
    ["/runs", "Agents", "/runs"],
    ["/runs/r-1", "Agents", "/runs"],
    ["/flow-runs", "API", "/flow-runs"],
  ])("on %s opens the %s group and marks its page", (pathname, group, href) => {
    // Collapsed by the user elsewhere: the current page opens it anyway.
    window.localStorage.setItem(navGroupStorageKey(group === "Agents" ? "agents" : "api"), "closed");
    const nav = renderSidebar(pathname);

    const button = nav.getByRole("button", { name: group });
    expect(button).toHaveAttribute("aria-expanded", "true");
    const list = document.getElementById(button.getAttribute("aria-controls")!)!;
    const current = within(list).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toEqual([href]);
    // No other link of the sidebar is current.
    expect(nav.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);
  });

  it("collapses and expands a group, and remembers the choice in this browser", async () => {
    const nav = renderSidebar("/");
    const api = nav.getByRole("button", { name: "API" });
    expect(api).toHaveAttribute("aria-expanded", "true");
    expect(nav.getByRole("link", { name: "Flows" })).toBeVisible();

    await userEvent.click(api);

    expect(api).toHaveAttribute("aria-expanded", "false");
    expect(nav.queryByRole("link", { name: "Flows" })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(navGroupStorageKey("api"))).toBe("closed");
    // The other group is independent.
    expect(nav.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-expanded", "true");
    cleanup();

    const again = renderSidebar("/live");
    expect(again.getByRole("button", { name: "API" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(again.getByRole("button", { name: "API" }));
    expect(again.getByRole("button", { name: "API" })).toHaveAttribute("aria-expanded", "true");
    expect(window.localStorage.getItem(navGroupStorageKey("api"))).toBe("open");
  });

  it("marks a collapsed group that holds the current page", async () => {
    const nav = renderSidebar("/flows");
    const api = nav.getByRole("button", { name: "API" });
    expect(api).not.toHaveAttribute("data-holds-current");

    await userEvent.click(api);

    expect(api).toHaveAttribute("aria-expanded", "false");
    expect(api).toHaveAttribute("data-holds-current");
    expect(nav.getByRole("button", { name: "Agents" })).not.toHaveAttribute("data-holds-current");
  });

  it("still works when the browser refuses to store the choice", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const nav = renderSidebar("/");

    await userEvent.click(nav.getByRole("button", { name: "Agents" }));

    expect(nav.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(nav.getByRole("button", { name: "Agents" }));
    expect(nav.getByRole("button", { name: "Agents" })).toHaveAttribute("aria-expanded", "true");
  });

  it.each(["/settings", "/settings/connections", "/settings/api-keys", "/settings/pricing"])(
    "keeps Settings marked on %s",
    (pathname) => {
      const nav = renderSidebar(pathname);

      expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
      expect(nav.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
    },
  );

  it("renders in Spanish when that is the page language", () => {
    renderWithClient(<Sidebar pathname="/settings/connections" user={ADA} onSignOut={vi.fn()} signingOut={false} />, {
      locale: "es",
    });
    const nav = within(screen.getByRole("navigation", { name: "Principal" }));

    expect(nav.getByRole("link", { name: "Configuración" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("button", { name: "Agentes" })).toBeInTheDocument();
    expect(nav.getByRole("button", { name: "API" })).toBeInTheDocument();
    const agents = within(nav.getByRole("list", { name: "Agentes" }));
    expect(agents.getAllByRole("link").map((link) => link.textContent)).toEqual(["Conexiones", "Escenarios", "Corridas"]);
    expect(within(nav.getByRole("list", { name: "API" })).getByRole("link", { name: "Flujos" })).toHaveAttribute(
      "href",
      "/flows",
    );
    expect(within(nav.getByRole("list", { name: "API" })).getByRole("link", { name: "Corridas" })).toHaveAttribute(
      "href",
      "/flow-runs",
    );
    expect(screen.queryByRole("radiogroup", { name: "Idioma" })).not.toBeInTheDocument();
  });

  it("shows the signed-in user", () => {
    renderSidebar("/");

    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("says when the account could not be loaded instead of spinning forever", () => {
    renderSidebar("/", { user: undefined, accountUnavailable: true });

    expect(screen.getByText("Account details unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the active-run count on Live sessions, and no badge when there is none", () => {
    const nav = renderSidebar("/", { badges: { "/live": 3 } });
    expect(nav.getByRole("link", { name: "Live sessions (3 active)" })).toHaveTextContent("3");
    cleanup();

    const idle = renderSidebar("/", { badges: { "/live": 0 } });
    expect(idle.getByRole("link", { name: "Live sessions" })).toHaveTextContent(/^Live sessions$/);
  });

  it("links the API docs in a new tab next to Settings", () => {
    const nav = renderSidebar("/");

    const docs = nav.getByRole("link", { name: "API docs (opens in a new tab)" });
    // One external-link icon before the label is enough: no trailing arrow.
    expect(docs).toHaveTextContent(/^API docs$/);
    expect(docs).toHaveAttribute("href", "/api/docs");
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", expect.stringContaining("noopener"));
    const links = nav.getAllByRole("link");
    expect(links.indexOf(docs)).toBeGreaterThan(links.indexOf(nav.getByRole("link", { name: "Settings" })));
  });

  it("links the public user guide next to the API docs", () => {
    const nav = renderSidebar("/");

    const guide = nav.getByRole("link", { name: "User guide" });
    expect(guide).toHaveAttribute("href", "/guide");
    const links = nav.getAllByRole("link");
    expect(links.indexOf(guide)).toBe(links.indexOf(nav.getByRole("link", { name: "API docs (opens in a new tab)" })) + 1);
  });

  it("shows no environment selector (there is nothing to switch to)", () => {
    renderSidebar("/");

    expect(screen.queryByText(/Environment/)).not.toBeInTheDocument();
    expect(document.querySelector("[data-environment]")).toBeNull();
  });
});
