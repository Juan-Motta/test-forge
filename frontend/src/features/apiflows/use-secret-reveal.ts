"use client";

import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/api";
import { revealSecrets } from "./api";

/**
 * The eye toggle of an API's credentials. Showing one asks the backend for the values at that
 * moment (never before, never cached in TanStack Query); hiding it, or leaving the component,
 * forgets the value. Only component state ever holds it.
 */
export function useSecretReveal(apiId: string) {
  const [shown, setShown] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  // A reply that lands after the component left (or after another toggle) is dropped.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  async function toggle(name: string) {
    setError(undefined);
    if (name in shown) {
      setShown((current) => {
        const rest = { ...current };
        delete rest[name];
        return rest;
      });
      return;
    }
    setPending(name);
    try {
      const { secrets } = await revealSecrets(apiId);
      if (!live.current) return;
      const value = secrets[name];
      if (value !== undefined) setShown((current) => ({ ...current, [name]: value }));
    } catch (failure) {
      if (live.current) setError(errorMessage(failure));
    } finally {
      if (live.current) setPending(null);
    }
  }

  return { shown, pending, error, toggle };
}
