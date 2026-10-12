import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tabs } from "./Tabs";

const TABS = [
  { id: "transcript", label: "Transcript & scorecard", content: <p>Transcript body</p> },
  { id: "trace", label: "Langfuse trace", content: <p>Trace body</p> },
  { id: "suggestions", label: "Suggestions", badge: 3, content: <p>Suggestions body</p> },
];

describe("Tabs", () => {
  it("renders a named tablist whose selected tab controls the visible panel", () => {
    render(<Tabs label="Report sections" tabs={TABS} />);

    expect(screen.getByRole("tablist", { name: "Report sections" })).toBeInTheDocument();
    const selected = screen.getByRole("tab", { name: "Transcript & scorecard" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    expect(selected).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Langfuse trace" })).toHaveAttribute("tabindex", "-1");
    const panel = screen.getByRole("tabpanel", { name: "Transcript & scorecard" });
    expect(panel).toHaveTextContent("Transcript body");
    expect(selected).toHaveAttribute("aria-controls", panel.id);
    expect(screen.queryByText("Trace body")).not.toBeInTheDocument();
  });

  it("switches panels on click", async () => {
    render(<Tabs label="Report sections" tabs={TABS} />);

    await userEvent.click(screen.getByRole("tab", { name: "Langfuse trace" }));

    expect(screen.getByRole("tabpanel", { name: "Langfuse trace" })).toHaveTextContent("Trace body");
    expect(screen.queryByText("Transcript body")).not.toBeInTheDocument();
  });

  it("moves with arrows, Home and End (automatic activation)", async () => {
    const onChange = vi.fn();
    render(<Tabs label="Report sections" tabs={TABS} onChange={onChange} />);
    screen.getByRole("tab", { name: "Transcript & scorecard" }).focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Langfuse trace" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "Langfuse trace" })).toHaveAttribute("aria-selected", "true");
    expect(onChange).toHaveBeenLastCalledWith("trace");

    await userEvent.keyboard("{End}");
    expect(screen.getByRole("tab", { name: /Suggestions/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Transcript & scorecard" })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{Home}");
    expect(screen.getByRole("tab", { name: "Transcript & scorecard" })).toHaveFocus();
  });

  it("follows a controlled value", () => {
    render(<Tabs label="Report sections" tabs={TABS} value="suggestions" onChange={vi.fn()} />);

    expect(screen.getByRole("tab", { name: /Suggestions/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /Suggestions/ })).toHaveTextContent("3");
  });

  it("falls back to the first tab when the controlled value is not among the tabs", () => {
    render(<Tabs label="Report sections" tabs={TABS} value={"gone" as string} onChange={vi.fn()} />);

    const first = screen.getByRole("tab", { name: "Transcript & scorecard" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel", { name: "Transcript & scorecard" })).toHaveTextContent("Transcript body");
  });

  it("falls back to the first tab when its own selection disappears from the tabs", async () => {
    const { rerender } = render(<Tabs label="Report sections" tabs={TABS} />);
    await userEvent.click(screen.getByRole("tab", { name: /Suggestions/ }));

    rerender(<Tabs label="Report sections" tabs={TABS.slice(0, 2)} />);

    expect(screen.getByRole("tab", { name: "Transcript & scorecard" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Transcript & scorecard" })).toHaveTextContent("Transcript body");
  });
});
