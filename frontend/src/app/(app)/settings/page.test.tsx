import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Page from "./page";

describe("Settings page", () => {
  it("opens the backend's API docs in a new tab from its card", () => {
    render(<Page />);

    const docs = screen.getByRole("link", { name: /API docs/ });
    expect(docs).toHaveAccessibleName(expect.stringContaining("(opens in a new tab)"));
    expect(docs).toHaveAttribute("href", "/api/docs");
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByRole("link", { name: /Connections/ })).toHaveAttribute("href", "/settings/connections");
    expect(screen.getByRole("link", { name: /API keys/ })).toHaveAttribute("href", "/settings/api-keys");
    expect(screen.getByRole("link", { name: /Model prices/ })).toHaveAttribute("href", "/settings/pricing");
  });
});
