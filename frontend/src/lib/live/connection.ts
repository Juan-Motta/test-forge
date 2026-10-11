import { redirectToLogin } from "@/lib/navigation/redirect";
import { liveUrl, openSocket, type LiveSocket } from "./socket";

/** Close codes of the backend's live endpoints (runs/live_api.py). */
export const CLOSE_NORMAL = 1000;
export const CLOSE_UNAUTHENTICATED = 4401;
export const CLOSE_FORBIDDEN_ORIGIN = 4403;
export const CLOSE_NOT_FOUND = 4404;

/** Delays before each reconnection attempt; after the last one the connection gives up. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const;

export type LiveConnectionState =
  | { kind: "connecting" }
  | { kind: "open" }
  | { kind: "reconnecting"; attempt: number; delayMs: number }
  | { kind: "ended" }
  | { kind: "error"; code: number; message: string };

export type LiveHandlers = {
  /** A parsed JSON text frame. */
  onMessage: (message: Record<string, unknown>) => void;
  /** A binary frame: its channel byte (0 agent, 1 caller) and the PCM16 bytes after it. */
  onAudio?: (channel: number, pcm: ArrayBuffer) => void;
  onState?: (state: LiveConnectionState) => void;
};

const REFUSALS: Record<number, string> = {
  [CLOSE_UNAUTHENTICATED]: "Your session expired. Taking you to sign in…",
  [CLOSE_FORBIDDEN_ORIGIN]: "This site is not allowed to open the live stream (origin refused).",
};
const GAVE_UP = "Lost the live connection. Reload the page to try again.";

/**
 * Opens `/api<path>` as a WebSocket and keeps it open: an unexpected close (anything but 1000
 * and the 44xx refusals) reconnects with a growing delay, and the server's fresh snapshot then
 * replaces what was shown. 4401 sends the browser to the login page.
 */
export function connectLive(path: string, handlers: LiveHandlers, notFoundMessage = "This run no longer exists.") {
  let socket: LiveSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let disposed = false;

  const setState = (state: LiveConnectionState) => {
    if (!disposed) handlers.onState?.(state);
  };

  function open() {
    setState({ kind: "connecting" });
    const current = openSocket(liveUrl(path));
    socket = current;
    current.binaryType = "arraybuffer";
    current.onopen = () => setState({ kind: "open" });
    current.onmessage = (event) => {
      if (disposed || socket !== current) return;
      attempts = 0; // the stream works again: a later drop starts the backoff over
      if (typeof event.data === "string") {
        let message: unknown;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message && typeof message === "object") handlers.onMessage(message as Record<string, unknown>);
      } else if (event.data instanceof ArrayBuffer && event.data.byteLength > 0) {
        const channel = new Uint8Array(event.data, 0, 1)[0];
        handlers.onAudio?.(channel, event.data.slice(1));
      }
    };
    current.onclose = (event) => {
      if (disposed || socket !== current) return;
      socket = null;
      closed(event.code);
    };
  }

  function closed(code: number) {
    if (code === CLOSE_NORMAL) {
      setState({ kind: "ended" });
      return;
    }
    if (code === CLOSE_UNAUTHENTICATED) {
      setState({ kind: "error", code, message: REFUSALS[code] });
      redirectToLogin();
      return;
    }
    if (code === CLOSE_NOT_FOUND) {
      setState({ kind: "error", code, message: notFoundMessage });
      return;
    }
    if (REFUSALS[code]) {
      setState({ kind: "error", code, message: REFUSALS[code] });
      return;
    }
    if (attempts >= RECONNECT_DELAYS_MS.length) {
      setState({ kind: "error", code, message: GAVE_UP });
      return;
    }
    const delayMs = RECONNECT_DELAYS_MS[attempts];
    attempts += 1;
    setState({ kind: "reconnecting", attempt: attempts, delayMs });
    timer = setTimeout(open, delayMs);
  }

  open();

  return {
    /** Stop for good: close the socket and cancel any pending reconnection. */
    close() {
      disposed = true;
      clearTimeout(timer);
      const current = socket;
      socket = null;
      current?.close(CLOSE_NORMAL);
    },
  };
}

export type LiveConnection = ReturnType<typeof connectLive>;
