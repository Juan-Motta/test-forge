import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PasswordInput } from "./PasswordInput";

describe("PasswordInput", () => {
  it("masks the value until the toggle reveals it", async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names the toggle after what it hides", () => {
    render(<PasswordInput aria-label="API key" subject="API key" />);

    expect(screen.getByRole("button", { name: "Show API key" })).toHaveAttribute("aria-pressed", "false");
  });
});
