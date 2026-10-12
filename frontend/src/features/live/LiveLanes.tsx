"use client";

import { AGENT_CHANNEL } from "@/lib/live/audio";
import { LEVEL_BIN_MS, type LevelMeter } from "@/lib/live/levels";
import { useNow } from "@/lib/time/use-now";
import { AudioLane, type LanePin } from "@/ui";
import { laneAxis } from "./live-view";

/** Bars per lane; with 250 ms bins the lanes show the last 24 s. */
export const LANE_BINS = 96;
const WINDOW_MS = LANE_BINS * LEVEL_BIN_MS;

type LiveLanesProps = {
  meter: LevelMeter;
  active: boolean;
  /** Run start and end (ms since the epoch), for the time axis; the lanes freeze at the end. */
  startedMs: number | null;
  endedMs: number | null;
};

/** The agent and evaluator audio of the last seconds, with the interruptions pinned on the agent's. */
export function LiveLanes({ meter, active, startedMs, endedMs }: LiveLanesProps) {
  const tick = useNow(active ? LEVEL_BIN_MS : 1000);
  const at = active || endedMs === null ? tick : endedMs;
  const { agent, caller } = meter.levels(at, LANE_BINS);
  const windowStart = at - WINDOW_MS;
  const cuts = meter.cuts(AGENT_CHANNEL);
  const pins: LanePin[] = cuts
    .map((cutAt, index) => ({ n: index + 1, at: (cutAt - windowStart) / WINDOW_MS, label: `Interruption ${index + 1}` }))
    // The clock ticks per bin: a cut within the current bin sits at the right edge.
    .filter((pin) => pin.at >= 0)
    .map((pin) => ({ ...pin, at: Math.min(1, pin.at) }));

  return (
    <div role="group" aria-label="Audio lanes" className="flex flex-col gap-2">
      <AudioLane
        label="Agent"
        tone="agent"
        values={agent}
        height={44}
        pins={cuts.length > 0 ? pins : undefined}
        pinsLabel="Cuts"
      />
      <AudioLane
        label="Evaluator"
        tone="evaluator"
        values={caller}
        height={44}
        axis={laneAxis(startedMs === null ? 0 : at - startedMs, WINDOW_MS)}
      />
    </div>
  );
}
