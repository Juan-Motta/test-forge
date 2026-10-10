/** `host[:port]` of the agent's WebSocket URL, or the URL itself when it cannot be parsed. */
export function urlHost(value: string): string {
  try {
    return new URL(value).host || value;
  } catch {
    return value;
  }
}
