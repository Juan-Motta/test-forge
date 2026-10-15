import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTheme } from "@/lib/browser/theme";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { renderWithClient } from "@/test/render";
import Page, { generateMetadata } from "./page";

const root = vi.hoisted(() => ({ lang: "en" }));
vi.mock("next/root-params", () => ({ lang: async () => root.lang }));

beforeEach(() => {
  root.lang = "en";
  setTheme("system");
  window.localStorage.clear();
});

afterEach(() => {
  document.cookie = `${LOCALE_COOKIE}=; path=/; max-age=0`;
});

describe("Settings page", () => {
  it("starts with Preferences: the theme and language switches, each explained", () => {
    renderWithClient(<Page />);

    const preferences = screen.getByRole("region", { name: "Preferences" });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings[0]).toBe("Preferences");
    expect(within(preferences).getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    expect(within(preferences).getByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
    expect(within(preferences).getByText(/System follows your device/)).toBeInTheDocument();
    expect(within(preferences).getByText(/language of the app/i)).toBeInTheDocument();
  });

  it("switches the theme of the page from Preferences", async () => {
    const user = userEvent.setup();
    renderWithClient(<Page />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("switches the language from Preferences and remembers it in the cookie", async () => {
    const user = userEvent.setup();
    renderWithClient(<Page />);

    await user.click(screen.getByRole("radio", { name: "ES" }));
    expect(document.cookie).toContain(`${LOCALE_COOKIE}=es`);
    expect(screen.getByRole("region", { name: "Preferencias" })).toBeInTheDocument();
  });

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
    expect(screen.getByRole("region", { name: "Preferencias" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Idioma" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Conexiones/ })).toHaveAttribute("href", "/settings/connections");
    expect(screen.getByRole("link", { name: /Claves de API/ })).toHaveAttribute("href", "/settings/api-keys");
    expect(screen.getByRole("link", { name: /Precios de modelos/ })).toHaveAttribute("href", "/settings/pricing");
    expect(screen.getByRole("link", { name: /se abre en una pestaña nueva/ })).toHaveAttribute("href", "/api/docs");
  });

  it("titles the tab in the page language", async () => {
    expect(await generateMetadata()).toEqual({ title: "Settings" });
    root.lang = "es";
    expect(await generateMetadata()).toEqual({ title: "Configuración" });
  });
});
