"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The current time (ms, rounded down to `intervalMs`), refreshed every `intervalMs`, for elapsed
 * timers and relative times. It reads the clock only in the browser: during prerendering it is
 * 0, which callers only ever show behind data that loads in the browser anyway.
 */
export function useNow(intervalMs = 1000): number {
  const subscribe = useCallback(
    (onTick: () => void) => {
      const timer = setInterval(onTick, intervalMs);
      return () => clearInterval(timer);
    },
    [intervalMs],
  );
  // Rounded, so every read within one interval returns the same value (a stable snapshot).
  const read = useCallback(() => Math.floor(Date.now() / intervalMs) * intervalMs, [intervalMs]);
  return useSyncExternalStore(subscribe, read, serverNow);
}

const serverNow = () => 0;
