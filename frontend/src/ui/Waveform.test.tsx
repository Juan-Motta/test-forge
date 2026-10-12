import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AudioLane } from "./AudioLane";
import { Pin } from "./Pin";
import { Waveform } from "./Waveform";

const bars = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-bar]"));

describe("Waveform", () => {
  it("draws one decorative bar per level and exposes only its text alternative", () => {
    const { container } = render(<Waveform values={[0, 0.5, 1]} label="Agent audio, 3 seconds" />);

    expect(bars(container)).toHaveLength(3);
    expect(container.querySelector("[aria-hidden='true']")).toContainElement(bars(container)[0] as HTMLElement);
    expect(screen.getByText("Agent audio, 3 seconds")).toHaveClass("sr-only");
  });

  it("scales bar heights to the lane height, never below the minimum", () => {
    const { container } = render(<Waveform values={[0, 0.5, 1, 7]} height={40} />);

    expect(bars(container).map((bar) => (bar as HTMLElement).style.height)).toEqual(["3px", "20px", "40px", "40px"]);
  });

  it("colours each bar by speaker in two-tone mode and marks silent bars", () => {
    const { container } = render(<Waveform values={[0.4, 0.4, 0.4]} tones={["agent", "evaluator", "silent"]} />);

    expect(bars(container).map((bar) => bar.getAttribute("data-tone"))).toEqual(["agent", "evaluator", "silent"]);
    expect((bars(container)[2] as HTMLElement).style.height).toBe("3px");
  });

  it("marks the played part of the waveform", () => {
    const { container } = render(<Waveform values={[0.2, 0.2, 0.2, 0.2]} progress={0.5} />);

    expect(bars(container).map((bar) => bar.hasAttribute("data-played"))).toEqual([true, true, false, false]);
  });
});

describe("Pin", () => {
  it("is a numbered link named after its issue when it has an href", () => {
    render(<Pin n={2} href="#suggestions" label="Issue 2: quoted the old rate" />);

    const pin = screen.getByRole("link", { name: "Issue 2: quoted the old rate" });
    expect(pin).toHaveTextContent("2");
    expect(pin).toHaveAttribute("href", "#suggestions");
  });

  it("is a button when it has an action, and decorative otherwise", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<Pin n={1} onClick={onClick} />);

    await userEvent.click(screen.getByRole("button", { name: "Issue 1" }));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(<Pin n={1} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });
});

describe("AudioLane", () => {
  it("labels the lane, describes its audio and draws the axis and pins", () => {
    const { container } = render(
      <AudioLane
        label="Agent"
        tone="agent"
        values={[0.1, 0.8]}
        axis={["00:00", "02:00", "04:12"]}
        pins={[{ n: 1, at: 0.25, href: "#s1", label: "Issue 1: slow reply" }]}
      />,
    );

    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Agent audio levels")).toHaveClass("sr-only");
    expect(bars(container)).toHaveLength(2);
    expect(screen.getByText("02:00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Issue 1: slow reply" }).parentElement).toHaveStyle({ left: "25%" });
  });
});
