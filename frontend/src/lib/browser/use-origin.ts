import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * The page's origin (`https://host:port`). Empty while prerendering on the server, where `window`
 * does not exist; the real value is filled in on hydration.
 */
export function useOrigin(): string {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => "",
  );
}
