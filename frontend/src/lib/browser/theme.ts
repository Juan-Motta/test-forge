"use client";

import { useCallback, useSyncExternalStore } from "react";
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme-init";

/** System follows the operating system; Light and Dark force a palette. */
export type ThemeChoice = "system" | "light" | "dark";

export { THEME_INIT_SCRIPT, THEME_STORAGE_KEY };

const listeners = new Set<() => void>();
/** The choice made on this page when the browser storage refused to keep it. */
let unsaved: ThemeChoice | undefined;

function isForced(value: string | null): value is "light" | "dark" {
  return value === "light" || value === "dark";
}

function read(): ThemeChoice {
  if (unsaved !== undefined) return unsaved;
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isForced(saved) ? saved : "system";
  } catch {
    // Storage blocked (private window, site data off): follow the system.
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** Applies a theme to this page, remembers it in this browser when it can, and notifies the hooks. */
export function setTheme(choice: ThemeChoice) {
  apply(choice);
  try {
    if (choice === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
    unsaved = undefined;
  } catch {
    unsaved = choice;
  }
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  // Another tab changed the theme: follow it here too.
  if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
  unsaved = undefined;
  apply(read());
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

const serverValue = (): ThemeChoice => "system";

/** The per-browser theme choice and a setter that applies it to <html>. */
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const choice = useSyncExternalStore(subscribe, read, serverValue);
  const set = useCallback((next: ThemeChoice) => setTheme(next), []);
  return [choice, set];
}
