import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StackedProgress } from "./StackedProgress";

const SEGMENTS = [
  { key: "completed", label: "completed", value: 2, tone: "success" as const },
  { key: "running", label: "running", value: 3, tone: "evaluator" as const },
  { key: "queued", label: "queued", value: 1, tone: "idle" as const },
];

describe("StackedProgress", () => {
  it("describes every segment in text and sizes the bar proportionally", () => {
    const { container } = render(<StackedProgress label="Batch progress" segments={SEGMENTS} extra="Concurrency 3" />);

    expect(screen.getByRole("img", { name: "Batch progress: 2 completed, 3 running, 1 queued" })).toBeInTheDocument();
    expect(screen.getByText("2 completed")).toBeInTheDocument();
    expect(screen.getByText("Concurrency 3")).toBeInTheDocument();
    const widths = Array.from(container.querySelectorAll("[data-segment]")).map((el) => (el as HTMLElement).style.flexGrow);
    expect(widths).toEqual(["2", "3", "1"]);
  });

  it("skips empty segments in the bar but keeps them in the legend", () => {
    const { container } = render(
      <StackedProgress label="Batch" segments={[...SEGMENTS.slice(0, 2), { ...SEGMENTS[2], value: 0 }]} />,
    );

    expect(container.querySelectorAll("[data-segment]")).toHaveLength(2);
    expect(screen.getByText("0 queued")).toBeInTheDocument();
  });
});
