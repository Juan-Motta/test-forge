import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FilterChips } from "./FilterChips";

const OPTIONS = [
  { value: "all", label: "All" },
  { value: "failed", label: "Failed", count: 4 },
];

describe("FilterChips", () => {
  it("is a named group of toggle buttons reflecting the selection with aria-pressed", () => {
    render(<FilterChips label="Filter runs" options={OPTIONS} selected={["all"]} onToggle={vi.fn()} />);

    expect(screen.getByRole("group", { name: "Filter runs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Failed/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /Failed/ })).toHaveTextContent("4");
  });

  it("reports the toggled value", async () => {
    const onToggle = vi.fn();
    render(<FilterChips label="Filter runs" options={OPTIONS} selected={["all"]} onToggle={onToggle} />);

    await userEvent.click(screen.getByRole("button", { name: /Failed/ }));

    expect(onToggle).toHaveBeenCalledWith("failed");
  });
});
