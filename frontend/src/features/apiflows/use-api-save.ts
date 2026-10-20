"use client";

import { useMemo, useRef, useState } from "react";
import { formErrorView, type FieldErrors } from "@/lib/api";
import { localizeFormError, useT } from "@/lib/i18n";
import { useUpdateApi } from "./queries";
import type { Api, ApiChanges } from "./types";

/** How a save ended: `unchanged` means nothing differed, so no request was sent. */
export type ApiSaveOutcome = "saved" | "unchanged";

export type ApiSave = {
  /** Sends the changes the form computed (only what differs from the stored API). */
  onSubmit: (changes: ApiChanges) => void;
  pending: boolean;
  /** Form-level error of the last failed save. */
  error?: string;
  /** Per-field errors of the last failed save (`name` for a taken name, `baseUrl` for a refused URL). */
  fieldErrors?: FieldErrors;
  /** Forgets the last failure (e.g. when another API is opened). */
  reset: () => void;
};

/**
 * Saves the open API's details with one PATCH. The double-submit guard and `pending` are per
 * API: a save still in flight for one API never blocks (or shows on) another opened meanwhile.
 */
export function useApiSave(api: Api | undefined, onSaved: (api: Api, outcome: ApiSaveOutcome) => void): ApiSave {
  const t = useT();
  const update = useUpdateApi();
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const saving = useRef(new Set<string>());
  // Mirrors `saving` for rendering.
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());

  function track(id: string, busy: boolean) {
    if (busy) saving.current.add(id);
    else saving.current.delete(id);
    setInFlight(new Set(saving.current));
  }

  function onSubmit(changes: ApiChanges) {
    if (!api || saving.current.has(api.id)) return;
    update.reset();
    if (Object.keys(changes).length === 0) {
      onSaved(api, "unchanged");
      return;
    }
    const id = api.id;
    track(id, true);
    // mutateAsync, not mutate's callbacks: `reset()` (opening another API) drops pending callbacks.
    // A failure is shown through the mutation's error state.
    update
      .mutateAsync({ id, changes })
      .then((saved) => onSaved(saved, "saved"))
      .catch(() => {})
      .finally(() => track(id, false));
  }

  // Memoized per failure: a new `fieldErrors` object means a new set of errors.
  const view = useMemo(
    () =>
      update.error ? localizeFormError(t, update.error, formErrorView(update.error, t("apis.error.taken"))) : undefined,
    [update.error, t],
  );

  return {
    onSubmit,
    pending: api ? inFlight.has(api.id) : false,
    error: view?.message,
    fieldErrors: view?.fieldErrors,
    reset: () => update.reset(),
  };
}
