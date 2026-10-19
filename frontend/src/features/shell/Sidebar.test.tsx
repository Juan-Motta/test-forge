import { cleanup, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import { activeHref, NAV_PRIMARY, NAV_SECONDARY } from "./navigation";
import { Sidebar } from "./Sidebar";

const ALL = [...NAV_PRIMARY, ...NAV_SECONDARY];

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
    ["/settings", "/settings"],
    ["/settings/connections", "/settings"],
    ["/settings/connections/abc", "/settings"],
    ["/settings/api-keys", "/settings"],
    ["/settings/pricing", "/settings"],
    ["/unknown", null],
  ])("%s -> %s", (pathname, expected) => {
    expect(activeHref(pathname, ALL)).toBe(expected);
  });
});

describe("Sidebar", () => {
  it("leaves the theme and language switches to Settings", () => {
    renderSidebar("/");
    expect(screen.queryByRole("radiogroup", { name: "Theme" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Language" })).not.toBeInTheDocument();
  });

  it("lists the main sections and Settings, but not Connections or API keys", () => {
    const nav = renderSidebar("/");
    const names = nav.getAllByRole("link").map((link) => link.textContent);

    expect(names.slice(0, 6)).toEqual(["Overview", "Live sessions", "Runs & reports", "Scenarios", "Agents", "Settings"]);
    expect(nav.queryByRole("link", { name: "Connections" })).not.toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "API keys" })).not.toBeInTheDocument();
  });

  it("marks only the current section with aria-current=page", () => {
    const nav = renderSidebar("/runs");

    expect(nav.getByRole("link", { name: "Runs & reports" })).toHaveAttribute("aria-current", "page");
    for (const name of ["Overview", "Live sessions", "Scenarios", "Agents", "Settings"]) {
      expect(nav.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
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
    expect(nav.queryByRole("link", { name: "Conexiones" })).not.toBeInTheDocument();
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
