/**
 * Live listening: plays the run's PCM16 24 kHz mono frames through Web Audio.
 *
 * Each channel (agent, caller) is scheduled back to back on its own timeline, starting a small
 * jitter buffer ahead of "now"; after an underrun the timeline restarts from now. Frames of a
 * channel the mix excludes are dropped. The AudioContext is created only by `start()`, which the
 * page calls from a click (browsers refuse to start audio without a user gesture).
 */
export const AGENT_CHANNEL = 0;
export const CALLER_CHANNEL = 1;
export const SAMPLE_RATE = 24_000;
/** Lead time before the first frame of a burst plays: absorbs network jitter. */
export const JITTER_S = 0.15;
/** Agents deliver whole replies faster than real time; queue them all (generous safety cap). */
export const MAX_BACKLOG_S = 300;

export type Mix = "both" | "agent" | "caller";

/** The AudioContext members the player uses (tests substitute a fake). */
export type AudioContextLike = {
  readonly currentTime: number;
  readonly destination: AudioNode;
  readonly state: AudioContextState;
  createGain(): GainNode;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  resume(): Promise<void>;
  close(): Promise<void>;
};

type ContextFactory = () => AudioContextLike;
const browserContext: ContextFactory = () => new AudioContext();
let contextFactory: ContextFactory = browserContext;

/** Replace how audio contexts are created (tests); `null` restores the browser's AudioContext. */
export function setAudioContextFactory(next: ContextFactory | null): void {
  contextFactory = next ?? browserContext;
}

export type LivePlayer = {
  readonly started: boolean;
  /** Creates and resumes the AudioContext; call it from a user gesture. */
  start(): Promise<void>;
  push(channel: number, pcm: ArrayBuffer): void;
  /** Silences what a channel has queued (e.g. an interrupted agent reply); later frames play from now. */
  cut(channel: number): void;
  setMix(mix: Mix): void;
  /** 0 to 1. */
  setVolume(volume: number): void;
  /** Releases the AudioContext; frames pushed afterwards are ignored. */
  stop(): void;
};

function plays(mix: Mix, channel: number): boolean {
  if (mix === "both") return channel === AGENT_CHANNEL || channel === CALLER_CHANNEL;
  return channel === (mix === "agent" ? AGENT_CHANNEL : CALLER_CHANNEL);
}

function toFloat(pcm: ArrayBuffer): Float32Array {
  const samples = new Int16Array(pcm, 0, Math.floor(pcm.byteLength / 2));
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] / 32768;
  return out;
}

export function createLivePlayer(): LivePlayer {
  let context: AudioContextLike | null = null;
  let master: GainNode | null = null;
  let mix: Mix = "both";
  let volume = 1;
  const next = new Map<number, number>();
  /** Sources scheduled or playing, per channel; each removes itself once it ends. */
  const sources = new Map<number, Set<AudioBufferSourceNode>>();

  return {
    get started() {
      return context !== null;
    },
    async start() {
      if (context) return;
      context = contextFactory();
      master = context.createGain();
      master.gain.value = volume;
      master.connect(context.destination);
      next.clear();
      sources.clear();
      try {
        await context.resume();
      } catch (error) {
        // Not started: release the context so a later click can try again from scratch.
        const failed = context;
        context = null;
        master = null;
        void failed.close().catch(() => undefined);
        throw error;
      }
    },
    push(channel, pcm) {
      if (!context || !master || !plays(mix, channel) || pcm.byteLength < 2) return;
      const samples = toFloat(pcm);
      const now = context.currentTime;
      const at = Math.max(next.get(channel) ?? 0, now + JITTER_S);
      if (at - now > MAX_BACKLOG_S) return;
      const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(master);
      const queued = sources.get(channel) ?? new Set<AudioBufferSourceNode>();
      sources.set(channel, queued);
      queued.add(source);
      source.onended = () => queued.delete(source);
      source.start(at);
      next.set(channel, at + samples.length / SAMPLE_RATE);
    },
    cut(channel) {
      if (!context) return;
      const queued = sources.get(channel);
      sources.delete(channel);
      next.delete(channel);
      for (const source of queued ?? []) {
        try {
          source.stop();
        } catch {
          // Already stopped: nothing left to silence.
        }
      }
    },
    setMix(value) {
      mix = value;
    },
    setVolume(value) {
      volume = Math.min(1, Math.max(0, value));
      if (master) master.gain.value = volume;
    },
    stop() {
      const current = context;
      context = null;
      master = null;
      next.clear();
      sources.clear();
      if (current && current.state !== "closed") void current.close().catch(() => undefined);
    },
  };
}
