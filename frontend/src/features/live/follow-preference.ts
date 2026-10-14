"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Where this browser remembers "Follow and listen automatically" ("on" / "off"). */
export const FOLLOW_STORAGE_KEY = "voice-eval:live:follow";

const listeners = new Set<() => void>();
/** The choice made on this page when the browser storage refused to keep it. */
let unsaved: boolean | undefined;

function read(): boolean {
  if (unsaved !== undefined) return unsaved;
  try {
    return window.localStorage.getItem(FOLLOW_STORAGE_KEY) === "on";
  } catch {
    // Storage blocked (private window, site data off): the option starts off.
    return false;
  }
}

function write(on: boolean) {
  try {
    window.localStorage.setItem(FOLLOW_STORAGE_KEY, on ? "on" : "off");
    unsaved = undefined;
  } catch {
    unsaved = on;
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverValue = () => false;

/** The per-browser "follow and listen" choice; off when the browser cannot remember it. */
export function useFollowPreference(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, serverValue);
  const set = useCallback((next: boolean) => write(next), []);
  return [on, set];
}
