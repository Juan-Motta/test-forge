import { setAudioContextFactory, type AudioContextLike } from "./audio";
import { setSocketFactory, type LiveSocket } from "./socket";

/** A WebSocket stand-in the test drives: open it, push JSON or binary frames, close it. */
export class FakeSocket implements LiveSocket {
  binaryType: BinaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closedByClient = false;

  constructor(readonly url: string) {}

  open() {
    this.onopen?.(new Event("open"));
  }

  send(message: Record<string, unknown>) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  /** One audio frame: channel byte (0 agent, 1 caller) then PCM16 samples. */
  audio(channel: 0 | 1, samples: number[]) {
    const bytes = new Uint8Array(1 + samples.length * 2);
    bytes[0] = channel;
    const view = new DataView(bytes.buffer);
    samples.forEach((sample, index) => view.setInt16(1 + index * 2, sample, true));
    this.onmessage?.(new MessageEvent("message", { data: bytes.buffer }));
  }

  /** The server (or the network) closes the connection. */
  serverClose(code: number, reason = "") {
    this.onclose?.(new CloseEvent("close", { code, reason, wasClean: code === 1000 }));
  }

  close() {
    this.closedByClient = true;
  }
}

/** Routes every `openSocket` to a new `FakeSocket`; call `restore()` after the test. */
export function installFakeSockets() {
  const sockets: FakeSocket[] = [];
  setSocketFactory((url) => {
    const socket = new FakeSocket(url);
    sockets.push(socket);
    return socket;
  });
  return {
    sockets,
    latest: () => {
      const socket = sockets.at(-1);
      if (!socket) throw new Error("no socket was opened");
      return socket;
    },
    restore: () => setSocketFactory(null),
  };
}

type Scheduled = { samples: Float32Array; when: number };

/** An AudioContext stand-in that records what would play, and when. */
export class FakeAudioContext implements AudioContextLike {
  currentTime = 0;
  state: AudioContextState = "suspended";
  readonly destination = {} as AudioNode;
  readonly scheduled: Scheduled[] = [];
  readonly master = { gain: { value: 1 }, connect: () => undefined };
  closed = false;

  createGain() {
    return this.master as unknown as GainNode;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: () => data,
      copyToChannel: (source: Float32Array) => data.set(source),
    } as unknown as AudioBuffer;
  }

  createBufferSource() {
    const scheduled = this.scheduled;
    const source = {
      buffer: null as AudioBuffer | null,
      connect: () => undefined,
      start(when: number) {
        scheduled.push({ samples: source.buffer?.getChannelData(0) ?? new Float32Array(), when });
      },
    };
    return source as unknown as AudioBufferSourceNode;
  }

  async resume() {
    this.state = "running";
  }

  async close() {
    this.closed = true;
    this.state = "closed";
  }
}

/** Routes every live player's AudioContext to a new `FakeAudioContext`; `restore()` afterwards. */
export function installFakeAudio() {
  const contexts: FakeAudioContext[] = [];
  setAudioContextFactory(() => {
    const context = new FakeAudioContext();
    contexts.push(context);
    return context;
  });
  return { contexts, restore: () => setAudioContextFactory(null) };
}
