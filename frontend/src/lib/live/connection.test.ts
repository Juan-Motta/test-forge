import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectLive, type LiveConnectionState } from "./connection";
import { installFakeSockets } from "./testing";

const redirect = vi.hoisted(() => ({ toLogin: vi.fn() }));
vi.mock("@/lib/navigation/redirect", () => ({ redirectToLogin: redirect.toLogin }));

let fake: ReturnType<typeof installFakeSockets>;

function connect() {
  const messages: unknown[] = [];
  const audio: [number, number][] = [];
  const states: LiveConnectionState[] = [];
  const connection = connectLive("/runs/r-1/live", {
    onMessage: (message) => messages.push(message),
    onAudio: (channel, pcm) => audio.push([channel, pcm.byteLength]),
    onState: (state) => states.push(state),
  });
  return { connection, messages, audio, states, last: () => states.at(-1) };
}

describe("live connection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fake = installFakeSockets();
    redirect.toLogin.mockReset();
  });
  afterEach(() => {
    fake.restore();
    vi.useRealTimers();
  });

  it("opens a same-origin ws:// URL and splits JSON messages from tagged audio frames", () => {
    const { messages, audio, last } = connect();
    const socket = fake.latest();
    expect(socket.url).toBe("ws://localhost:3000/api/runs/r-1/live");
    expect(socket.binaryType).toBe("arraybuffer");
    expect(last()).toEqual({ kind: "connecting" });

    socket.open();
    socket.send({ type: "snapshot", transcript: [] });
    socket.audio(1, [1, 2, 3]);
    socket.audio(0, [4]);

    expect(last()).toEqual({ kind: "open" });
    expect(messages).toEqual([{ type: "snapshot", transcript: [] }]);
    expect(audio).toEqual([
      [1, 6],
      [0, 2],
    ]);
  });

  it("ends quietly on a normal close", () => {
    const { last } = connect();
    fake.latest().open();
    fake.latest().serverClose(1000);
    vi.advanceTimersByTime(60_000);
    expect(last()).toEqual({ kind: "ended" });
    expect(fake.sockets).toHaveLength(1);
  });

  it("reconnects after an unexpected close with a growing delay, reset by a good connection", () => {
    const { last } = connect();
    fake.latest().open();
    fake.latest().serverClose(1006);
    expect(last()).toEqual({ kind: "reconnecting", attempt: 1, delayMs: 1000 });
    vi.advanceTimersByTime(999);
    expect(fake.sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(fake.sockets).toHaveLength(2);

    fake.latest().serverClose(1006); // failed again before opening
    expect(last()).toEqual({ kind: "reconnecting", attempt: 2, delayMs: 2000 });
    vi.advanceTimersByTime(2000);
    fake.latest().open();
    fake.latest().send({ type: "snapshot" });
    fake.latest().serverClose(1011);
    expect(last()).toEqual({ kind: "reconnecting", attempt: 1, delayMs: 1000 });
  });

  it("also retries a consumer the server dropped as too slow (1013)", () => {
    const { last } = connect();
    fake.latest().open();
    fake.latest().serverClose(1013);
    expect(last()).toMatchObject({ kind: "reconnecting" });
  });

  it("gives up after the last attempt", () => {
    const { last } = connect();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      fake.latest().serverClose(1006);
      vi.advanceTimersByTime(60_000);
    }
    expect(last()).toEqual({ kind: "error", code: 1006, message: "Lost the live connection. Reload the page to try again." });
  });

  it("sends the user to the login page on 4401 and does not retry", () => {
    const { last } = connect();
    fake.latest().open();
    fake.latest().serverClose(4401);
    vi.advanceTimersByTime(60_000);
    expect(redirect.toLogin).toHaveBeenCalledTimes(1);
    expect(last()).toMatchObject({ kind: "error", code: 4401 });
    expect(fake.sockets).toHaveLength(1);
  });

  it.each([
    [4404, "This run no longer exists."],
    [4403, "This site is not allowed to open the live stream (origin refused)."],
  ])("explains close code %i without retrying", (code, message) => {
    const { last } = connect();
    fake.latest().serverClose(code);
    vi.advanceTimersByTime(60_000);
    expect(last()).toEqual({ kind: "error", code, message });
    expect(fake.sockets).toHaveLength(1);
  });

  it("stops for good when closed by the page", () => {
    const { connection, messages } = connect();
    const socket = fake.latest();
    socket.open();
    connection.close();
    expect(socket.closedByClient).toBe(true);
    socket.send({ type: "late" });
    socket.serverClose(1006);
    vi.advanceTimersByTime(60_000);
    expect(messages).toEqual([]);
    expect(fake.sockets).toHaveLength(1);
  });
});
