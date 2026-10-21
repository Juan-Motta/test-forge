"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import { revealSecrets } from "./api";

const NONE: ReadonlySet<string> = new Set();

/**
 * The eye toggle of an API's credentials. Showing one asks the backend for the values at that
 * moment (never before, never cached in TanStack Query); hiding it, or leaving the component,
 * forgets the value. Only component state ever holds it.
 *
 * Every eye waiting at the same time shares one request, and each keeps its own pending state.
 */
export function useSecretReveal(apiId: string) {
  const [shown, setShown] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<ReadonlySet<string>>(NONE);
  const [error, setError] = useState<string>();
  const inFlight = useRef<Promise<Record<string, string>> | null>(null);
  // A reply that lands after the component left is dropped.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  function fetchOnce() {
    inFlight.current ??= revealSecrets(apiId)
      .then(({ secrets }) => secrets)
      .finally(() => {
        inFlight.current = null;
      });
    return inFlight.current;
  }

  /** Forgets the values of these secrets (an eye turned off, a row turned plain or removed). */
  function hide(names: string[]) {
    setError(undefined);
    setShown((current) => {
      const rest = { ...current };
      for (const name of names) delete rest[name];
      return rest;
    });
  }

  async function reveal(names: string[]) {
    const wanted = names.filter((name) => !pending.has(name));
    if (wanted.length === 0) return;
    setError(undefined);
    setPending((current) => new Set([...current, ...wanted]));
    try {
      const secrets = await fetchOnce();
      if (!live.current) return;
      setShown((current) => {
        const next = { ...current };
        for (const name of wanted) if (secrets[name] !== undefined) next[name] = secrets[name];
        return next;
      });
    } catch (failure) {
      if (live.current) setError(errorMessage(failure));
    } finally {
      if (live.current) {
        setPending((current) => {
          const next = new Set(current);
          for (const name of wanted) next.delete(name);
          return next;
        });
      }
    }
  }

  /** Shows one secret, or hides it when shown; a click while it is pending does nothing. */
  async function toggle(name: string) {
    if (name in shown) hide([name]);
    else await reveal([name]);
  }

  /** One eye for several secrets: hides them all when all are shown, otherwise shows them all. */
  async function toggleAll(names: string[]) {
    if (names.length > 0 && names.every((name) => name in shown)) hide(names);
    else await reveal(names.filter((name) => !(name in shown)));
  }

  return { shown, pending, error, toggle, toggleAll, hide };
}

export type SecretReveal = ReturnType<typeof useSecretReveal>;
