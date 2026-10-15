import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithClient } from "@/test/render";
import LoginPage, { generateMetadata } from "./page";

const root = vi.hoisted(() => ({ lang: "en" }));
vi.mock("next/root-params", () => ({ lang: async () => root.lang }));

// The form has its own tests; here only the page around it matters.
vi.mock("@/features/auth/LoginContainer", () => ({ LoginContainer: () => null }));

describe("Login page", () => {
  it("points newcomers to the public user guide", () => {
    render(<LoginPage />);

    expect(screen.getByRole("heading", { name: "Sign in to Duet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New here? Read the guide" })).toHaveAttribute("href", "/guide");
  });

  it("lets the visitor pick the theme", () => {
    render(<LoginPage />);
    expect(screen.getByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
  });

  it("lets the visitor pick the language", () => {
    render(<LoginPage />);
    expect(screen.getByRole("radiogroup", { name: "Language" })).toBeInTheDocument();
  });

  it("renders in Spanish when that is the page language", () => {
    renderWithClient(<LoginPage />, { locale: "es" });
    expect(screen.getByRole("heading", { name: "Inicia sesión en Duet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "¿Primera vez aquí? Lee la guía" })).toHaveAttribute("href", "/guide");
    expect(screen.getByRole("radiogroup", { name: "Idioma" })).toBeInTheDocument();
  });

  it("titles the tab in the page language", async () => {
    expect(await generateMetadata()).toEqual({ title: "Sign in" });
    root.lang = "es";
    expect(await generateMetadata()).toEqual({ title: "Iniciar sesión" });
  });
});
