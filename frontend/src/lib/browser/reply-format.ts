"use client";

import { useCallback, useSyncExternalStore } from "react";

/** How text agents' replies are shown: rendered Markdown, or the raw text as sent. */
export type ReplyFormat = "markdown" | "raw";

export const REPLY_FORMAT_STORAGE_KEY = "voice-eval:reply-format";
const CHANGED = "voice-eval:reply-format-changed";

function read(): ReplyFormat {
  try {
    return window.localStorage.getItem(REPLY_FORMAT_STORAGE_KEY) === "raw" ? "raw" : "markdown";
  } catch {
    return "markdown"; // storage blocked (private mode, policy): the default
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/** The preference, remembered in this browser (Markdown by default) and shared live by every view. */
export function useReplyFormat(): [ReplyFormat, (format: ReplyFormat) => void] {
  const format = useSyncExternalStore(subscribe, read, () => "markdown" as const);
  const setFormat = useCallback((next: ReplyFormat) => {
    try {
      if (next === "markdown") window.localStorage.removeItem(REPLY_FORMAT_STORAGE_KEY);
      else window.localStorage.setItem(REPLY_FORMAT_STORAGE_KEY, next);
    } catch {
      // not remembered; this view still follows the choice below
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [format, setFormat];
}
