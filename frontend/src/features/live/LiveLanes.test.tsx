import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AGENT_CHANNEL, SAMPLE_RATE } from "@/lib/live/audio";
import { LEVEL_BIN_MS, createLevelMeter } from "@/lib/live/levels";
import { LiveLanes } from "./LiveLanes";

function tone(ms: number, amplitude: number): ArrayBuffer {
  const samples = new Int16Array(Math.round((SAMPLE_RATE * ms) / 1000));
  for (let i = 0; i < samples.length; i += 1) samples[i] = i % 2 === 0 ? amplitude : -amplitude;
  return samples.buffer;
}

/** Bars of a lane taller than the silent minimum. */
function loudBars(name: string): number {
  const lane = screen.getByText(name, { selector: "span" }).parentElement!;
  return [...lane.querySelectorAll<HTMLElement>("[data-bar]")].filter((bar) => parseFloat(bar.style.height) > 4).length;
}

/** Browser clock of the page (the meter's own). */
const PAGE_MS = 1_000_000;

describe("LiveLanes", () => {
  it("freezes an ended run on the meter's last sample, whatever the server's end time says", () => {
    const meter = createLevelMeter();
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS * 8, 16000), PAGE_MS);
    // The server's clock runs an hour ahead of the page's.
    const serverStart = PAGE_MS + 3_600_000 - 10_000;
    render(<LiveLanes meter={meter} active={false} startedMs={serverStart} endedMs={serverStart + 12_000} />);

    expect(loudBars("Agent")).toBeGreaterThanOrEqual(7);
  });

  it("numbers interruption pins over the whole run, not within the visible window", () => {
    const meter = createLevelMeter();
    meter.cut(AGENT_CHANNEL, PAGE_MS);
    meter.cut(AGENT_CHANNEL, PAGE_MS + 1000);
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS, 16000), PAGE_MS + 90_000);
    meter.cut(AGENT_CHANNEL, PAGE_MS + 90_100);
    render(<LiveLanes meter={meter} active={false} startedMs={null} endedMs={PAGE_MS + 90_500} />);

    const cuts = screen.getByText("Cuts").parentElement!;
    expect(within(cuts).getByText("3")).toBeInTheDocument();
    expect(within(cuts).queryByText("1")).not.toBeInTheDocument();
  });
});
