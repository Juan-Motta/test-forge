"use client";

import { useMemo, useRef } from "react";
import { formErrorView, type FieldErrors } from "@/lib/api";
import { toChanges, toNewAgent, type AgentFormValues } from "./form-schema";
import { useCreateAgent, useUpdateAgent } from "./queries";
import type { Agent } from "./types";

export const DUPLICATE_AGENT_NAME = "An agent with this name already exists.";

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

/** Saves the form: creates without `agent`, otherwise PATCHes only what changed. */
export function useAgentSave(agent: Agent | undefined, onSaved: (agent: Agent, outcome: SaveOutcome) => void): AgentSave {
  const create = useCreateAgent();
  const update = useUpdateAgent();
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const saving = useRef(false);
  const save = agent ? update : create;

  function reset() {
    create.reset();
    update.reset();
  }

  function onSubmit(values: AgentFormValues) {
    if (saving.current) return;
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
    saving.current = true;
    // mutateAsync, not mutate's callbacks: `reset()` (opening another agent) drops pending callbacks.
    // A failure is shown through the mutation's error state.
    request.catch(() => {}).finally(() => (saving.current = false));
  }

  // Memoized per failure: a new `fieldErrors` object tells the form to show a new set of errors.
  const view = useMemo(() => (save.error ? formErrorView(save.error, DUPLICATE_AGENT_NAME) : undefined), [save.error]);

  return { onSubmit, pending: save.isPending, error: view?.message, fieldErrors: view?.fieldErrors, reset };
}
