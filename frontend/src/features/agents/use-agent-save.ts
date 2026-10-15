"use client";

import { useMemo, useRef, useState } from "react";
import { formErrorView, type FieldErrors } from "@/lib/api";
import { localizeFormError, useT } from "@/lib/i18n";
import { toChanges, toNewAgent, type AgentFormValues } from "./form-schema";
import { useCreateAgent, useUpdateAgent } from "./queries";
import type { Agent } from "./types";

/** How a save ended: `unchanged` means nothing differed, so no request was sent. */
export type SaveOutcome = "created" | "saved" | "unchanged";

export type AgentSave = {
  onSubmit: (values: AgentFormValues) => void;
  pending: boolean;
  /** Form-level error of the last failed save. */
  error?: string;
  /** Per-field errors of the last failed save; a new object for every new failure. */
  fieldErrors?: FieldErrors;
  /** Forgets the last failure (e.g. when another agent is opened). */
  reset: () => void;
};

/** The in-flight key of a save that creates an agent. */
const NEW_AGENT = "\u0000new";

/**
 * Saves the form: creates without `agent`, otherwise PATCHes only what changed. The double-submit
 * guard and `pending` are per agent: a save still in flight for one agent never blocks (or shows
 * on) another the user opened meanwhile.
 */
export function useAgentSave(agent: Agent | undefined, onSaved: (agent: Agent, outcome: SaveOutcome) => void): AgentSave {
  const t = useT();
  const create = useCreateAgent();
  const update = useUpdateAgent();
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const saving = useRef(new Set<string>());
  // Mirrors `saving` for rendering.
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const save = agent ? update : create;
  const key = agent?.id ?? NEW_AGENT;

  function track(id: string, busy: boolean) {
    if (busy) saving.current.add(id);
    else saving.current.delete(id);
    setInFlight(new Set(saving.current));
  }

  function reset() {
    create.reset();
    update.reset();
  }

  function onSubmit(values: AgentFormValues) {
    if (saving.current.has(key)) return;
    reset();
    let request: Promise<void>;
    if (agent) {
      const changes = toChanges(agent, values);
      if (Object.keys(changes).length === 0) {
        onSaved(agent, "unchanged");
        return;
      }
      request = update.mutateAsync({ id: agent.id, changes }).then((saved) => onSaved(saved, "saved"));
    } else {
      request = create.mutateAsync(toNewAgent(values)).then((created) => onSaved(created, "created"));
    }
    track(key, true);
    // mutateAsync, not mutate's callbacks: `reset()` (opening another agent) drops pending callbacks.
    // A failure is shown through the mutation's error state.
    request.catch(() => {}).finally(() => track(key, false));
  }

  // Memoized per failure: a new `fieldErrors` object tells the form to show a new set of errors.
  const view = useMemo(
    () =>
      save.error ? localizeFormError(t, save.error, formErrorView(save.error, t("agents.duplicateName"))) : undefined,
    [save.error, t],
  );

  return { onSubmit, pending: inFlight.has(key), error: view?.message, fieldErrors: view?.fieldErrors, reset };
}
