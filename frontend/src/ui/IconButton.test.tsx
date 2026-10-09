import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IconButton } from "./IconButton";
import { MenuIcon } from "./icons";

describe("IconButton", () => {
  it("exposes its label as the accessible name", () => {
    render(<IconButton label="Open menu" icon={<MenuIcon />} />);

    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("type", "button");
  });

  it("uses the label as the tooltip too and forwards other button props", () => {
    render(<IconButton label="Close" icon={<MenuIcon />} disabled />);

    const button = screen.getByRole("button", { name: "Close" });
    expect(button).toHaveAttribute("title", "Close");
    expect(button).toBeDisabled();
  });

  it("keeps its label as the name even if an aria-label slips through", () => {
    const stray = { "aria-label": "Something else" };
    render(<IconButton label="Open menu" icon={<MenuIcon />} {...stray} />);

    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("title", "Open menu");
  });
});
