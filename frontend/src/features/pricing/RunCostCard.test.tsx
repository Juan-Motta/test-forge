import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RunCostCard } from "./RunCostCard";
import { runCostFixture } from "./testing";

describe("RunCostCard", () => {
  it("shows the evaluator, judge and total cost with a breakdown by model", async () => {
    render(<RunCostCard cost={runCostFixture()} />);
    const card = screen.getByRole("group", { name: "Evaluation cost" });

    expect(within(card).getByText("≈ $0.4435")).toBeInTheDocument();
    const amount = (label: string) => within(card).getByText(label).parentElement?.textContent;
    expect(amount("Evaluator")).toBe("Evaluator$0.4123");
    expect(amount("Judge")).toBe("Judge$0.0312");
    expect(within(card).getByText(/approximate \(OpenAI list prices\)/i)).toBeInTheDocument();

    await userEvent.setup().click(within(card).getByText("By model"));
    const breakdown = within(card).getByRole("list", { name: "Cost by model" });
    const lines = within(breakdown).getAllByRole("listitem").map((item) => item.textContent);
    expect(lines).toEqual(["Evaluator · gpt-realtime-2.1-mini$0.4123", "Judge · gpt-6-luna$0.0312"]);
  });

  it("says what an incomplete cost leaves out", () => {
    const cost = runCostFixture({
      complete: false,
      notes: ["TTS audio not priced: the speech endpoint reports no usage"],
      breakdown: [{ part: "caller", model: "gpt-4o-mini-tts", usd: 0.001 }],
    });
    render(<RunCostCard cost={cost} />);
    expect(screen.getByText("≈ $0.4435+")).toBeInTheDocument();
    expect(screen.getByText("TTS audio not priced: the speech endpoint reports no usage")).toBeInTheDocument();
  });

  it("shows a dash for a part or a run without recorded usage", () => {
    const { rerender } = render(<RunCostCard cost={runCostFixture({ judgeUsd: null })} />);
    const judge = screen.getByText("Judge").parentElement as HTMLElement;
    expect(within(judge).getByText("—")).toBeInTheDocument();

    rerender(<RunCostCard cost={null} />);
    expect(screen.getByRole("group", { name: "Evaluation cost" })).toHaveTextContent("—");
    expect(screen.getByText("No usage was recorded for this run.")).toBeInTheDocument();
  });
});
