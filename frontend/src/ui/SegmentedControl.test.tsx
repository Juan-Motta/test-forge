import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SegmentedControl } from "./SegmentedControl";

const MODES = [
  { value: "both", label: "Both" },
  { value: "agent", label: "Agent only" },
  { value: "evaluator", label: "Evaluator only" },
] as const;

function Harness() {
  const [mode, setMode] = useState<(typeof MODES)[number]["value"]>("both");
  return <SegmentedControl label="Audio mix" options={MODES} value={mode} onChange={setMode} />;
}

describe("SegmentedControl", () => {
  it("is a radio group with exactly one checked, focusable option", () => {
    render(<Harness />);

    const group = screen.getByRole("radiogroup", { name: "Audio mix" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Both" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Both" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Agent only" })).toHaveAttribute("tabindex", "-1");
  });

  it("selects on click", async () => {
    render(<Harness />);

    await userEvent.click(screen.getByRole("radio", { name: "Evaluator only" }));

    expect(screen.getByRole("radio", { name: "Evaluator only" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Both" })).toHaveAttribute("aria-checked", "false");
  });

  it("moves and selects with the arrow keys, wrapping around", async () => {
    render(<Harness />);
    screen.getByRole("radio", { name: "Both" }).focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "Agent only" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Agent only" })).toHaveAttribute("aria-checked", "true");

    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(screen.getByRole("radio", { name: "Evaluator only" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "Evaluator only" })).toHaveAttribute("aria-checked", "true");
  });

  it("checks nothing for an unknown value but keeps the first option reachable by Tab", () => {
    render(<SegmentedControl label="Audio mix" options={MODES} value={"other" as "both"} onChange={() => {}} />);

    for (const radio of screen.getAllByRole("radio")) expect(radio).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Both" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Agent only" })).toHaveAttribute("tabindex", "-1");
  });
});
