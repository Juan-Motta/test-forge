import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Switch } from "./Switch";

describe("Switch", () => {
  it("is named by its label, described by its hint, and reports the flipped value", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Follow" hint="Opens each run as it starts." />);

    const control = screen.getByRole("switch", { name: "Follow" });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveAccessibleDescription("Opens each run as it starts.");
    await userEvent.setup().click(control);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows the checked state", () => {
    render(<Switch checked onChange={() => undefined} label="Follow" />);
    expect(screen.getByRole("switch", { name: "Follow" })).toHaveAttribute("aria-checked", "true");
  });
});
