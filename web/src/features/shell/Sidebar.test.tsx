import { render, screen, within } from "@testing-library/react";
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
    ["/unknown", null],
  ])("%s -> %s", (pathname, expected) => {
    expect(activeHref(pathname, ALL)).toBe(expected);
  });
});

describe("Sidebar", () => {
  it("marks only the current section with aria-current=page", () => {
    const nav = renderSidebar("/runs");

    expect(nav.getByRole("link", { name: "Runs & reports" })).toHaveAttribute("aria-current", "page");
    for (const name of ["Overview", "Live sessions", "Scenarios", "Agents", "Settings", "Connections"]) {
      expect(nav.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
  });

  it("marks the settings child, not its parent, on the connections page", () => {
    const nav = renderSidebar("/settings/connections");

    expect(nav.getByRole("link", { name: "Connections" })).toHaveAttribute("aria-current", "page");
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
});
