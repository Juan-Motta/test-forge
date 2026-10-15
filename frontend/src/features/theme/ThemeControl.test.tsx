import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { THEME_STORAGE_KEY, setTheme } from "@/lib/browser/theme";
import { ThemeControl } from "./ThemeControl";

beforeEach(() => {
  setTheme("system");
  window.localStorage.clear();
});

describe("ThemeControl", () => {
  it("offers System, Light and Dark with System checked by default", () => {
    render(<ThemeControl />);
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "false");
  });

  it("switches the theme of the page", async () => {
    const user = userEvent.setup();
    render(<ThemeControl />);
    await user.click(screen.getByRole("radio", { name: "Light" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "true");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    await user.click(screen.getByRole("radio", { name: "System" }));
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});
