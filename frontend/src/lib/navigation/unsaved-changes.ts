"use client";

import { useEffect } from "react";

export const LEAVE_MESSAGE = "You have unsaved changes. Leave this page and discard them?";

/** The page currently holding unsaved changes, if any (one editor is visible at a time). */
let pending: string | null = null;

/**
 * Asks before an in-app navigation (sidebar links, Cancel) would discard unsaved changes.
 * True when there is nothing to lose or the user agrees to leave.
 */
export function confirmLeave(): boolean {
  return pending === null || window.confirm(pending);
}

/**
 * While `dirty`, warns before the tab closes or reloads (`beforeunload`) and makes
 * `confirmLeave` ask before in-app navigations. Browser back/forward inside the app is not
 * intercepted: the App Router has no API to block it.
 *
 * Effects are torn down when Next hides a preserved page (Activity), so a hidden editor never
 * blocks navigation from the visible one.
 */
export function useUnsavedChangesGuard(dirty: boolean, message: string = LEAVE_MESSAGE) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    pending = message;
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      if (pending === message) pending = null;
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, message]);
}
