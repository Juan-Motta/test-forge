import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KpiTile } from "./KpiTile";

describe("KpiTile", () => {
  it("is a group named by its label with the value, unit and sub-line", () => {
    render(<KpiTile label="Average judge score" value="74" unit="/ 100" sub="12 judged" />);

    const tile = screen.getByRole("group", { name: "Average judge score" });
    expect(tile).toHaveTextContent("74");
    expect(tile).toHaveTextContent("/ 100");
    expect(tile).toHaveTextContent("12 judged");
  });

  it("colours an upward delta as good when up is good, and says so to screen readers", () => {
    render(<KpiTile label="Runs" value="128" delta={{ text: "+34 vs previous week", trend: "up" }} />);

    const delta = screen.getByText("+34 vs previous week").closest("[data-trend]");
    expect(delta).toHaveAttribute("data-trend", "up");
    expect(delta).toHaveAttribute("data-quality", "better");
    expect(delta).toHaveTextContent("(better)");
  });

  it("treats a drop as good when lower is better (e.g. latency)", () => {
    render(<KpiTile label="Latency" value="1.2" unit="s" delta={{ text: "-0.3 s", trend: "down", goodWhen: "down" }} />);

    expect(screen.getByText("-0.3 s").closest("[data-trend]")).toHaveAttribute("data-quality", "better");
  });

  it("marks a drop in a higher-is-better metric as worse, and a neutral delta as neither", () => {
    const { rerender } = render(<KpiTile label="Goal" value="81%" delta={{ text: "-3 pts", trend: "down" }} />);
    expect(screen.getByText("-3 pts").closest("[data-trend]")).toHaveAttribute("data-quality", "worse");

    rerender(<KpiTile label="Goal" value="81%" delta={{ text: "p95 2.9 s", trend: "flat" }} />);
    const flat = screen.getByText("p95 2.9 s").closest("[data-trend]");
    expect(flat).toHaveAttribute("data-quality", "neutral");
    expect(flat).not.toHaveTextContent("(");
  });
});
