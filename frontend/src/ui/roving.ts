import type { KeyboardEvent } from "react";

/**
 * Index a roving-focus widget (radio group, tablist) moves to for a key, or null when the key is
 * not a navigation key. Arrows wrap; Home/End jump to the ends.
 */
export function rovingIndex(event: KeyboardEvent, current: number, count: number): number | null {
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
