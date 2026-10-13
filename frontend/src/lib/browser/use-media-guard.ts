"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";

/**
 * Keeps the audio and video players inside `container` well behaved:
 * - one plays at a time (starting one pauses the others);
 * - all pause when the component is hidden or unmounted. Next keeps visited pages mounted but
 *   hidden (`<Activity>`, `display: none`), and a hidden media element keeps playing otherwise.
 */
export function useMediaGuard(container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    function onPlay(event: Event) {
      for (const media of root!.querySelectorAll<HTMLMediaElement>("audio, video")) {
        if (media !== event.target) media.pause();
      }
    }
    root.addEventListener("play", onPlay, true); // media events do not bubble
    return () => root.removeEventListener("play", onPlay, true);
  }, [container]);

  // A layout effect cleans up before the page is hidden, so nothing plays on behind it.
  useLayoutEffect(() => {
    const root = container.current;
    return () => {
      for (const media of root?.querySelectorAll<HTMLMediaElement>("audio, video") ?? []) media.pause();
    };
  }, [container]);
}
