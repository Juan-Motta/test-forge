import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./Badge";
import { LiveDot } from "./LiveDot";

describe("Badge", () => {
  it.each(["muted", "outline"] as const)("supports the %s tone", (tone) => {
    render(<Badge tone={tone}>Queued</Badge>);

    expect(screen.getByText("Queued")).toHaveAttribute("data-tone", tone);
  });
});

describe("LiveDot", () => {
  it("is decorative without a label", () => {
    const { container } = render(<LiveDot />);

    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("announces its label and stops pulsing for reduced motion", () => {
    const { container } = render(<LiveDot label="Live" />);

    expect(screen.getByText("Live")).toHaveClass("sr-only");
    expect(container.querySelector(".motion-safe\\:animate-ping")).not.toBeNull();
  });
});
