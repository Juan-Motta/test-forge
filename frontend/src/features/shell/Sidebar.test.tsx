import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { activeHref, NAV_PRIMARY, NAV_SECONDARY } from "./navigation";
import { Sidebar } from "./Sidebar";

const ALL = [...NAV_PRIMARY, ...NAV_SECONDARY];

const ADA = { displayName: "Ada Lovelace", email: "ada@example.com" };

function renderSidebar(pathname: string, overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  render(
    <Sidebar
      pathname={pathname}
      environmentLabel="dev"
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
    ["/settings", "/settings"],
    ["/settings/connections", "/settings/connections"],
    ["/settings/connections/abc", "/settings/connections"],
    ["/settings/api-keys", "/settings/api-keys"],
    ["/unknown", null],
  ])("%s -> %s", (pathname, expected) => {
    expect(activeHref(pathname, ALL)).toBe(expected);
  });
});

describe("Sidebar", () => {
  it("marks only the current section with aria-current=page", () => {
    const nav = renderSidebar("/runs");

    expect(nav.getByRole("link", { name: "Runs & reports" })).toHaveAttribute("aria-current", "page");
    for (const name of ["Overview", "Live sessions", "Scenarios", "Agents", "Settings", "Connections", "API keys"]) {
      expect(nav.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
  });

  it("marks the settings child, not its parent, on the connections page", () => {
    const nav = renderSidebar("/settings/connections");

    expect(nav.getByRole("link", { name: "Connections" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
  });

  it("lists API keys under Settings, next to Connections, and marks it on its page", () => {
    const nav = renderSidebar("/settings/api-keys");
    const links = nav.getAllByRole("link").map((link) => link.textContent);

    expect(links.indexOf("API keys")).toBe(links.indexOf("Connections") + 1);
    expect(nav.getByRole("link", { name: "API keys" })).toHaveAttribute("href", "/settings/api-keys");
    expect(nav.getByRole("link", { name: "API keys" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "Settings" })).not.toHaveAttribute("aria-current");
  });

  it("shows the environment and the signed-in user", () => {
    renderSidebar("/");

    expect(screen.getByText("Environment · dev")).toBeInTheDocument();
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

  it("draws the environment as a pill with a chevron, not as a control", () => {
    renderSidebar("/");

    const pill = screen.getByText("Environment · dev").closest("[data-environment]");
    expect(pill).not.toBeNull();
    expect(pill?.querySelector("svg")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Environment/ })).not.toBeInTheDocument();
  });
});
