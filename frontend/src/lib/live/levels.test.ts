import { describe, expect, it } from "vitest";
import { AGENT_CHANNEL, CALLER_CHANNEL, SAMPLE_RATE } from "./audio";
import { LEVEL_BIN_MS, LEVEL_GAIN, createLevelMeter, dominantTones } from "./levels";

/** `ms` of PCM16 at a constant amplitude (alternating sign, so it is a real signal). */
function tone(ms: number, amplitude: number): ArrayBuffer {
  const samples = new Int16Array(Math.round((SAMPLE_RATE * ms) / 1000));
  for (let i = 0; i < samples.length; i += 1) samples[i] = i % 2 === 0 ? amplitude : -amplitude;
  return samples.buffer;
}

const level = (amplitude: number) => Math.min(1, (amplitude / 32768) * LEVEL_GAIN);

describe("level meter", () => {
  it("buckets each channel's frames into RMS bins on the time they cover", () => {
    const meter = createLevelMeter();
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS, 3277), 1000);

    const { agent, caller } = meter.levels(1000 + LEVEL_BIN_MS, 4);
    // Bins ending at the one holding "now": 500, 750, 1000 (the frame), 1250.
    expect(agent[0]).toBe(0);
    expect(agent[1]).toBe(0);
    expect(agent[2]).toBeCloseTo(level(3277), 3);
    expect(agent[3]).toBe(0);
    expect(caller).toEqual([0, 0, 0, 0]);
  });

  it("keeps the channels apart", () => {
    const meter = createLevelMeter();
    meter.push(CALLER_CHANNEL, tone(LEVEL_BIN_MS, 6554), 0);
    const { agent, caller } = meter.levels(0, 1);
    expect(agent).toEqual([0]);
    expect(caller[0]).toBeCloseTo(level(6554), 3);
  });

  it("clamps loud audio to 1", () => {
    const meter = createLevelMeter();
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS, 30000), 0);
    expect(meter.levels(0, 1).agent).toEqual([1]);
  });

  it("queues frames that arrive faster than real time back to back, shown as they play", () => {
    const meter = createLevelMeter();
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS, 3277), 1000);
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS, 3277), 1000);

    // At 1000 the second frame has not played yet: the window ends at the current bin.
    expect(meter.levels(1000, 2).agent.map((value) => value > 0)).toEqual([false, true]);
    expect(meter.levels(1000 + LEVEL_BIN_MS, 3).agent.map((value) => value > 0)).toEqual([false, true, true]);
  });

  it("restarts a channel's timeline from now after it ran dry", () => {
    const meter = createLevelMeter();
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS, 3277), 0);
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS, 3277), 1000);
    expect(meter.levels(1000, 5).agent.map((value) => value > 0)).toEqual([true, false, false, false, true]);
  });

  it("drops what a channel queued ahead when it is cut, and only that channel", () => {
    const meter = createLevelMeter();
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS * 4, 3277), 0);
    meter.push(CALLER_CHANNEL, tone(LEVEL_BIN_MS * 4, 3277), 0);
    meter.cut(AGENT_CHANNEL, LEVEL_BIN_MS);

    const later = meter.levels(LEVEL_BIN_MS * 3, 4);
    expect(later.agent.map((value) => value > 0)).toEqual([true, true, false, false]);
    expect(later.caller.map((value) => value > 0)).toEqual([true, true, true, true]);

    // After the cut, the next frame plays from now, not after the dropped audio.
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS, 3277), LEVEL_BIN_MS * 3);
    expect(meter.levels(LEVEL_BIN_MS * 3, 1).agent[0]).toBeGreaterThan(0);
  });

  it("remembers when each channel was cut, within its history", () => {
    const meter = createLevelMeter();
    meter.cut(AGENT_CHANNEL, 1000);
    meter.cut(AGENT_CHANNEL, 5000);
    meter.cut(CALLER_CHANNEL, 2000);
    expect(meter.cuts(AGENT_CHANNEL)).toEqual([
      { n: 1, atMs: 1000 },
      { n: 2, atMs: 5000 },
    ]);
    expect(meter.cuts(CALLER_CHANNEL)).toEqual([{ n: 1, atMs: 2000 }]);
    meter.push(CALLER_CHANNEL, tone(LEVEL_BIN_MS, 3277), 600_000);
    expect(meter.cuts(AGENT_CHANNEL)).toEqual([]);
  });

  it("numbers cuts over the whole run, so a cut keeps its number when older ones are forgotten", () => {
    const meter = createLevelMeter();
    meter.cut(AGENT_CHANNEL, 1000);
    meter.cut(AGENT_CHANNEL, 2000);
    meter.cut(AGENT_CHANNEL, 600_000);
    expect(meter.cuts(AGENT_CHANNEL)).toEqual([{ n: 3, atMs: 600_000 }]);
  });

  it("knows when its last sample ends, or when it was last cut, in its own clock", () => {
    const meter = createLevelMeter();
    expect(meter.lastSampleMs()).toBeNull();
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS * 2, 3277), 1000);
    expect(meter.lastSampleMs()).toBe(1000 + LEVEL_BIN_MS * 2);
    meter.push(CALLER_CHANNEL, tone(LEVEL_BIN_MS, 3277), 1100);
    expect(meter.lastSampleMs()).toBe(1000 + LEVEL_BIN_MS * 2);
    meter.cut(AGENT_CHANNEL, 4000);
    expect(meter.lastSampleMs()).toBe(4000);
  });

  it("forgets audio older than its history", () => {
    const meter = createLevelMeter();
    meter.push(AGENT_CHANNEL, tone(LEVEL_BIN_MS, 3277), 0);
    meter.push(CALLER_CHANNEL, tone(LEVEL_BIN_MS, 3277), 600_000);
    expect(meter.levels(LEVEL_BIN_MS * 3, 4).agent).toEqual([0, 0, 0, 0]);
  });

  it("ignores empty frames", () => {
    const meter = createLevelMeter();
    meter.push(AGENT_CHANNEL, new ArrayBuffer(1), 0);
    expect(meter.levels(0, 2).agent).toEqual([0, 0]);
  });
});

describe("dominant tones", () => {
  it("colours each bar by the louder speaker, and quiet bars as silent", () => {
    const { values, tones } = dominantTones({ agent: [0.5, 0.1, 0, 0.01], caller: [0.2, 0.6, 0, 0.005] });
    expect(values).toEqual([0.5, 0.6, 0, 0.01]);
    expect(tones).toEqual(["agent", "evaluator", "silent", "silent"]);
  });
});
