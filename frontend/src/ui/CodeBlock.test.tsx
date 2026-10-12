import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { CodeBlock } from "./CodeBlock";

describe("CodeBlock", () => {
  it("shows the code in a focusable, labelled pre without a copy button by default", () => {
    render(<CodeBlock code={"# Brief\nFix the rate"} label="Handoff brief" />);

    const pre = screen.getByRole("region", { name: "Handoff brief" });
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveAttribute("tabindex", "0");
    expect(pre).toHaveTextContent("# Brief Fix the rate");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("copies the code and confirms it", async () => {
    const user = userEvent.setup();
    render(<CodeBlock code="curl /api/runs" label="Command" copyable />);

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe("curl /api/runs");
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });
});
