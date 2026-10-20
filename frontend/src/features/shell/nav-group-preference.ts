"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Where this browser remembers whether a sidebar group is open ("open" / "closed"), per group id. */
export const navGroupStorageKey = (id: string) => `voice-eval:nav:group:${id}`;

const listeners = new Set<() => void>();
/** Choices made on this page when the browser storage refused to keep them. */
const unsaved = new Map<string, boolean>();

function read(id: string): boolean {
  const kept = unsaved.get(id);
  if (kept !== undefined) return kept;
  try {
    return window.localStorage.getItem(navGroupStorageKey(id)) !== "closed";
  } catch {
    // Storage blocked (private window, site data off): groups start open.
    return true;
  }
}

function write(id: string, open: boolean) {
  try {
    window.localStorage.setItem(navGroupStorageKey(id), open ? "open" : "closed");
    unsaved.delete(id);
  } catch {
    unsaved.set(id, open);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverValue = () => true;

/** Whether this browser keeps the group open; open until the user collapses it. */
export function useNavGroupPreference(id: string): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, () => read(id), serverValue);
  const set = useCallback((next: boolean) => write(id, next), [id]);
  return [open, set];
}
