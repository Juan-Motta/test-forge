import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchField } from "./SearchField";

describe("SearchField", () => {
  it("is a search box named by its (visually hidden) label", async () => {
    const onChange = vi.fn();
    render(<SearchField label="Search runs" placeholder="Search runs, scenarios, threads" onChange={onChange} />);

    const box = screen.getByRole("searchbox", { name: "Search runs" });
    expect(box).toHaveAttribute("placeholder", "Search runs, scenarios, threads");
    expect(screen.getByText("Search runs")).toHaveClass("sr-only");

    await userEvent.type(box, "R-22");
    expect(onChange).toHaveBeenCalledTimes(4);
  });
});
