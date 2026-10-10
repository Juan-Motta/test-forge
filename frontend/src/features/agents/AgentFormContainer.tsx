"use client";

import { useMemo, useRef } from "react";
import { useConnections } from "@/features/connections/queries";
import { formErrorView } from "@/lib/api";
import { Spinner } from "@/ui";
import { AgentForm, type LangfuseOption } from "./AgentForm";
import { toChanges, toNewAgent, type AgentFormValues } from "./form-schema";
import { useCreateAgent, useUpdateAgent } from "./queries";
import type { Agent } from "./types";

export const DUPLICATE_AGENT_NAME = "An agent with this name already exists.";

type AgentFormContainerProps = {
  /** Present when editing. */
  agent?: Agent;
  onCancel: () => void;
  onSaved: (agent: Agent) => void;
};

/**
 * Container: loads the Langfuse connections and saves (create, or PATCH with only what changed).
 * Mounted only while its dialog is open, so every opening starts with clean mutation state.
 */
export function AgentFormContainer({ agent, onCancel, onSaved }: AgentFormContainerProps) {
  const connections = useConnections();
  const create = useCreateAgent();
  const update = useUpdateAgent();
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const saving = useRef(false);
  const save = agent ? update : create;

  function onSubmit(values: AgentFormValues) {
    if (saving.current) return;
    create.reset();
    update.reset();
    const done = { onSuccess: onSaved, onSettled: () => (saving.current = false) };
    if (agent) {
      const changes = toChanges(agent, values);
      if (Object.keys(changes).length === 0) {
        onSaved(agent);
        return;
      }
      saving.current = true;
      update.mutate({ id: agent.id, changes }, done);
    } else {
      saving.current = true;
      create.mutate(toNewAgent(values), done);
    }
  }

  // Memoized per failure: a new `fieldErrors` object tells the form to show a new set of errors.
  const view = useMemo(() => (save.error ? formErrorView(save.error, DUPLICATE_AGENT_NAME) : undefined), [save.error]);

  if (connections.isPending) return <Spinner label="Loading connections" />;

  const langfuseOptions: LangfuseOption[] = (connections.data ?? [])
    .filter((connection) => connection.kind === "langfuse")
    .map(({ id, name }) => ({ id, name }));

  return (
    <AgentForm
      agent={agent}
      langfuseOptions={langfuseOptions}
      langfuseHint={connections.isError ? "Could not load connections; only None is offered." : undefined}
      onSubmit={onSubmit}
      onCancel={onCancel}
      pending={save.isPending}
      error={view?.message}
      serverFieldErrors={view?.fieldErrors}
    />
  );
}
