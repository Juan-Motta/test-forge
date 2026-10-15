"use client";

import { AGENT_CHANNEL } from "@/lib/live/audio";
import { LEVEL_BIN_MS, type LevelMeter } from "@/lib/live/levels";
import { useNow } from "@/lib/time/use-now";
import { useT } from "@/lib/i18n";
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
  const t = useT();
  const tick = useNow(active ? LEVEL_BIN_MS : 1000);
  // Bars live on the page's clock (the meter's); the run's end is on the server's. An ended run
  // freezes on the meter's last sample, never on the server end time.
  const frozen = !active && endedMs !== null;
  const at = frozen ? (meter.lastSampleMs() ?? tick) : tick;
  const { agent, caller } = meter.levels(at, LANE_BINS);
  const windowStart = at - WINDOW_MS;
  const cuts = meter.cuts(AGENT_CHANNEL);
  const pins: LanePin[] = cuts
    .map((cut) => ({ n: cut.n, at: (cut.atMs - windowStart) / WINDOW_MS, label: t("live.interruption", { n: cut.n }) }))
    // The clock ticks per bin: a cut within the current bin sits at the right edge.
    .filter((pin) => pin.at >= 0)
    .map((pin) => ({ ...pin, at: Math.min(1, pin.at) }));
  // The axis counts run time: server end minus server start once ended, else the page's elapsed.
  const elapsed = startedMs === null ? 0 : frozen ? endedMs - startedMs : at - startedMs;

  return (
    <div role="group" aria-label={t("live.audioLanes")} className="flex flex-col gap-2">
      <AudioLane
        label={t("common.agent")}
        tone="agent"
        values={agent}
        height={44}
        pins={cuts.length > 0 ? pins : undefined}
        pinsLabel={t("live.cuts")}
      />
      <AudioLane
        label={t("common.evaluator")}
        tone="evaluator"
        values={caller}
        height={44}
        axis={laneAxis(t, elapsed, WINDOW_MS)}
      />
    </div>
  );
}
