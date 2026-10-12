/**
 * Live audio levels: an RMS meter over the PCM16 frames the live stream delivers, per channel,
 * whether or not anyone is listening.
 *
 * Like the player, each channel's frames are laid back to back on its own timeline from the
 * moment they arrive (agents send whole replies faster than real time), so a bar lights up when
 * its audio would play, not when it was received. Time is in the caller's clock (`Date.now()`
 * in the page) and split into fixed bins; a cut (interruption) drops what a channel had queued.
 */
import { AGENT_CHANNEL, CALLER_CHANNEL, MAX_BACKLOG_S, SAMPLE_RATE } from "./audio";

/** Width of one level bin. */
export const LEVEL_BIN_MS = 250;
/** Bins kept behind "now" (a minute): enough for every lane the page draws. */
export const LEVEL_HISTORY_BINS = 240;
/** Speech rarely exceeds an RMS of ~0.3: scale it so a normal voice fills most of the lane. */
export const LEVEL_GAIN = 3;
/** Below this level a bar counts as silence. */
export const SILENT_LEVEL = 0.02;

const MS_PER_SAMPLE = 1000 / SAMPLE_RATE;

export type ChannelLevels = { agent: number[]; caller: number[] };

/** One cut of a channel: its number over the whole run (1-based) and when it happened (ms). */
export type LevelCut = { n: number; atMs: number };

export type LevelMeter = {
  /** One frame of a channel, received at `nowMs`. */
  push(channel: number, pcm: ArrayBuffer, nowMs: number): void;
  /** Drops what `channel` queued after `nowMs` (e.g. the interrupted rest of an agent reply). */
  cut(channel: number, nowMs: number): void;
  /** The cuts of `channel` within the meter's history, oldest first, numbered over the whole run. */
  cuts(channel: number): LevelCut[];
  /**
   * Where the last sample of any channel ends, or the last cut if later (ms, the meter's clock);
   * null before anything arrived. An ended run's lanes freeze here.
   */
  lastSampleMs(): number | null;
  /** The last `count` bins of each channel, 0..1, ending with the bin that holds `nowMs`. */
  levels(nowMs: number, count: number): ChannelLevels;
};

type Bin = { sumSquares: number; samples: number };

const binOf = (ms: number) => Math.floor(ms / LEVEL_BIN_MS);

export function createLevelMeter(): LevelMeter {
  const bins = new Map<number, Map<number, Bin>>([
    [AGENT_CHANNEL, new Map()],
    [CALLER_CHANNEL, new Map()],
  ]);
  /** Where each channel's next frame starts (ms). */
  const next = new Map<number, number>();
  const cutTimes = new Map<number, LevelCut[]>();
  /** Cuts per channel since the meter was created, pruned ones included. */
  const cutCounts = new Map<number, number>();
  let last: number | null = null;
  const reach = (ms: number) => {
    last = last === null ? ms : Math.max(last, ms);
  };

  function prune(nowMs: number) {
    const oldest = binOf(nowMs) - LEVEL_HISTORY_BINS;
    for (const channel of bins.values()) {
      for (const index of channel.keys()) if (index < oldest) channel.delete(index);
    }
    for (const [channel, times] of cutTimes) cutTimes.set(channel, times.filter((cut) => binOf(cut.atMs) >= oldest));
  }

  function series(channel: Map<number, Bin>, last: number, count: number): number[] {
    const out: number[] = [];
    for (let index = last - count + 1; index <= last; index += 1) {
      const bin = channel.get(index);
      out.push(bin && bin.samples > 0 ? Math.min(1, Math.sqrt(bin.sumSquares / bin.samples) * LEVEL_GAIN) : 0);
    }
    return out;
  }

  return {
    push(channel, pcm, nowMs) {
      const target = bins.get(channel);
      const count = Math.floor(pcm.byteLength / 2);
      if (!target || count === 0) return;
      const start = Math.max(next.get(channel) ?? nowMs, nowMs);
      if (start - nowMs > MAX_BACKLOG_S * 1000) return;
      const samples = new Int16Array(pcm, 0, count);
      for (let i = 0; i < count; i += 1) {
        const index = binOf(start + i * MS_PER_SAMPLE);
        const bin = target.get(index) ?? { sumSquares: 0, samples: 0 };
        const value = samples[i] / 32768;
        bin.sumSquares += value * value;
        bin.samples += 1;
        target.set(index, bin);
      }
      next.set(channel, start + count * MS_PER_SAMPLE);
      reach(start + count * MS_PER_SAMPLE);
      prune(nowMs);
    },
    cut(channel, nowMs) {
      const target = bins.get(channel);
      if (!target) return;
      const current = binOf(nowMs);
      for (const index of target.keys()) if (index > current) target.delete(index);
      next.delete(channel);
      const n = (cutCounts.get(channel) ?? 0) + 1;
      cutCounts.set(channel, n);
      cutTimes.set(channel, [...(cutTimes.get(channel) ?? []), { n, atMs: nowMs }]);
      reach(nowMs);
      prune(nowMs);
    },
    cuts(channel) {
      return cutTimes.get(channel) ?? [];
    },
    lastSampleMs() {
      return last;
    },
    levels(nowMs, count) {
      const last = binOf(nowMs);
      return {
        agent: series(bins.get(AGENT_CHANNEL)!, last, count),
        caller: series(bins.get(CALLER_CHANNEL)!, last, count),
      };
    },
  };
}

export type DominantTone = "agent" | "evaluator" | "silent";

/** One two-tone series: each bar takes the louder speaker's level and colour (silent when quiet). */
export function dominantTones({ agent, caller }: ChannelLevels): { values: number[]; tones: DominantTone[] } {
  const values: number[] = [];
  const tones: DominantTone[] = [];
  agent.forEach((agentLevel, index) => {
    const callerLevel = caller[index] ?? 0;
    const value = Math.max(agentLevel, callerLevel);
    values.push(value);
    tones.push(value < SILENT_LEVEL ? "silent" : agentLevel >= callerLevel ? "agent" : "evaluator");
  });
  return { values, tones };
}
