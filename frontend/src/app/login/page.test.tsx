import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginPage from "./page";

// The form has its own tests; here only the page around it matters.
vi.mock("@/features/auth/LoginContainer", () => ({ LoginContainer: () => null }));

describe("Login page", () => {
  it("points newcomers to the public user guide", () => {
    render(<LoginPage />);

    expect(screen.getByRole("heading", { name: "Sign in to Duet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New here? Read the guide" })).toHaveAttribute("href", "/guide");
  });
});
