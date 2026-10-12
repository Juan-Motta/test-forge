import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_CHANNEL, CALLER_CHANNEL, JITTER_S, createLivePlayer } from "./audio";
import { installFakeAudio } from "./testing";

let audio: ReturnType<typeof installFakeAudio>;

function pcm(samples: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return buffer;
}

const AGENT = pcm([16384, 16384]); // 0.5
const CALLER = pcm([-8192, -8192]); // -0.25

describe("live player", () => {
  beforeEach(() => {
    audio = installFakeAudio();
  });
  afterEach(() => audio.restore());

  it("does nothing until started by the user", () => {
    const player = createLivePlayer();
    player.push(AGENT_CHANNEL, AGENT);
    expect(audio.contexts).toHaveLength(0);
    expect(player.started).toBe(false);
  });

  it("decodes PCM16 and schedules each channel back to back after a small jitter buffer", async () => {
    const player = createLivePlayer();
    await player.start();
    const context = audio.contexts[0];
    expect(context.state).toBe("running");

    player.push(AGENT_CHANNEL, AGENT);
    player.push(AGENT_CHANNEL, AGENT);
    player.push(CALLER_CHANNEL, CALLER);

    const [first, second, caller] = context.scheduled;
    expect(Array.from(first.samples)).toEqual([0.5, 0.5]);
    expect(first.when).toBeCloseTo(JITTER_S);
    expect(second.when).toBeCloseTo(JITTER_S + 2 / 24000);
    expect(Array.from(caller.samples)).toEqual([-0.25, -0.25]);
    expect(caller.when).toBeCloseTo(JITTER_S);
  });

  it("plays only the channels of the chosen mix", async () => {
    const player = createLivePlayer();
    await player.start();
    const context = audio.contexts[0];

    player.setMix("agent");
    player.push(AGENT_CHANNEL, AGENT);
    player.push(CALLER_CHANNEL, CALLER);
    player.setMix("caller");
    player.push(AGENT_CHANNEL, AGENT);
    player.push(CALLER_CHANNEL, CALLER);

    expect(context.scheduled.map((item) => item.samples[0])).toEqual([0.5, -0.25]);
  });

  it("restarts the schedule after an underrun instead of playing in the past", async () => {
    const player = createLivePlayer();
    await player.start();
    const context = audio.contexts[0];
    player.push(AGENT_CHANNEL, AGENT);
    context.currentTime = 5;
    player.push(AGENT_CHANNEL, AGENT);
    expect(context.scheduled[1].when).toBeCloseTo(5 + JITTER_S);
  });

  it("sets the volume and releases the audio context when stopped", async () => {
    const player = createLivePlayer();
    await player.start();
    const context = audio.contexts[0];
    player.setVolume(0.3);
    expect(context.master.gain.value).toBeCloseTo(0.3);
    player.stop();
    expect(context.closed).toBe(true);
    expect(player.started).toBe(false);
    player.push(AGENT_CHANNEL, AGENT);
    expect(context.scheduled).toHaveLength(0);
  });

  it("cuts the agent's queued audio now, leaving the caller's alone, and schedules later frames from now", async () => {
    const player = createLivePlayer();
    await player.start();
    const context = audio.contexts[0];
    player.push(AGENT_CHANNEL, AGENT);
    player.push(AGENT_CHANNEL, AGENT);
    player.push(AGENT_CHANNEL, AGENT);
    player.push(CALLER_CHANNEL, pcm(new Array(24000).fill(-8192))); // 1 s queued
    context.scheduled[0].end(); // already played out: nothing left to stop

    context.currentTime = 0.1;
    player.cut(AGENT_CHANNEL);

    expect(context.scheduled.map((item) => item.stopped)).toEqual([false, true, true, false]);
    player.push(AGENT_CHANNEL, AGENT);
    player.push(CALLER_CHANNEL, CALLER);
    expect(context.scheduled[4].when).toBeCloseTo(0.1 + JITTER_S);
    expect(context.scheduled[5].when).toBeCloseTo(JITTER_S + 1);
  });

  it("ignores a cut before it starts", () => {
    const player = createLivePlayer();
    expect(() => player.cut(AGENT_CHANNEL)).not.toThrow();
  });

  it("stays stopped, with the context released, when the browser refuses to start audio", async () => {
    audio.restore();
    audio = installFakeAudio({ resumeError: new Error("The user did not allow audio") });
    const player = createLivePlayer();

    await expect(player.start()).rejects.toThrow("The user did not allow audio");
    expect(player.started).toBe(false);
    expect(audio.contexts[0].closed).toBe(true);
    player.push(AGENT_CHANNEL, AGENT);
    expect(audio.contexts[0].scheduled).toHaveLength(0);
  });
});
