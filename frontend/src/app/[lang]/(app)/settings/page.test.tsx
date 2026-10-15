import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import Page, { generateMetadata } from "./page";

const root = vi.hoisted(() => ({ lang: "en" }));
vi.mock("next/root-params", () => ({ lang: async () => root.lang }));

beforeEach(() => {
  root.lang = "en";
});

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

  it("renders in Spanish when that is the page language", () => {
    renderWithClient(<Page />, { locale: "es" });

    expect(screen.getByRole("heading", { level: 1, name: "Configuración" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Conexiones/ })).toHaveAttribute("href", "/settings/connections");
    expect(screen.getByRole("link", { name: /Precios de modelos/ })).toHaveAttribute("href", "/settings/pricing");
    expect(screen.getByRole("link", { name: /se abre en una pestaña nueva/ })).toHaveAttribute("href", "/api/docs");
  });

  it("titles the tab in the page language", async () => {
    expect(await generateMetadata()).toEqual({ title: "Settings" });
    root.lang = "es";
    expect(await generateMetadata()).toEqual({ title: "Configuración" });
  });
});
