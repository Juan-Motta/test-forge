import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreBar } from "./ScoreBar";
import { scoreTone } from "./score";

describe("scoreTone", () => {
  it.each([
    [100, "good"],
    [80, "good"],
    [79.9, "warn"],
    [60, "warn"],
    [59, "bad"],
    [0, "bad"],
  ])("%s -> %s", (score, tone) => {
    expect(scoreTone(score)).toBe(tone);
  });
});

describe("ScoreBar", () => {
  it("is a 0-100 meter named by its label, coloured by the score band", () => {
    render(<ScoreBar score={72} label="Confirms price" />);

    const meter = screen.getByRole("meter", { name: "Confirms price" });
    expect(meter).toHaveAttribute("aria-valuenow", "72");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "100");
    expect(meter).toHaveAttribute("data-tone", "warn");
  });

  it("clamps the fill to the track and can print the value", () => {
    const { container } = render(<ScoreBar score={140} label="Score" showValue />);

    expect(screen.getByRole("meter", { name: "Score" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(container.querySelector("[data-fill]")).toHaveStyle({ width: "100%" });
  });

  it("shows an empty track and an em dash when there is no score yet", () => {
    render(<ScoreBar score={null} label="Score" showValue />);

    expect(screen.getByRole("meter", { name: "Score" })).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByRole("meter", { name: "Score" })).toHaveAttribute("aria-valuetext", "Not scored");
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
