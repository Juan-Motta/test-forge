import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IconButton } from "./IconButton";
import { MenuIcon } from "./icons";

describe("IconButton", () => {
  it("exposes its label as the accessible name", () => {
    render(<IconButton label="Open menu" icon={<MenuIcon />} />);

    expect(screen.getByRole("button", { name: "Open menu" })).toHaveAttribute("type", "button");
  });

  it("requires a label at the type level", () => {
    // @ts-expect-error -- an icon-only button without a label has no accessible name
    const element = <IconButton icon={<MenuIcon />} />;
    expect(element).toBeTruthy();
  });
});
