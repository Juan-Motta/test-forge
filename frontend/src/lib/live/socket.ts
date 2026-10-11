/**
 * The few WebSocket members the live stream uses, behind a swappable factory so tests can drive
 * a fake socket (see `testing.ts`) instead of the network.
 */
export type LiveSocket = {
  binaryType: BinaryType;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close(code?: number, reason?: string): void;
};

export type SocketFactory = (url: string) => LiveSocket;

const browserSocket: SocketFactory = (url) => new WebSocket(url);
let factory: SocketFactory = browserSocket;

/** Replace how sockets are opened (tests); `null` restores the browser's WebSocket. */
export function setSocketFactory(next: SocketFactory | null): void {
  factory = next ?? browserSocket;
}

export function openSocket(url: string): LiveSocket {
  return factory(url);
}

/**
 * `ws(s)://<this origin>/api<path>`: the same origin as the page, so the browser sends the
 * session cookie and an `Origin` the backend accepts.
 */
export function liveUrl(path: string): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/api${path}`;
}
