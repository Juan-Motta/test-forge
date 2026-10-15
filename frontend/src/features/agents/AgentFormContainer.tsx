"use client";

import { useConnections } from "@/features/connections/queries";
import type { Connection } from "@/features/connections/types";
import { useT } from "@/lib/i18n";
import { Spinner } from "@/ui";
import { AgentForm, type LangfuseOption } from "./AgentForm";
import type { Agent } from "./types";
import { useAgentSave, type SaveOutcome } from "./use-agent-save";

/** The Langfuse connections an agent may link to, with the host the traces come from. */
export function langfuseOptionsOf(connections: Connection[] | undefined): LangfuseOption[] {
  return (connections ?? [])
    .filter((connection) => connection.kind === "langfuse")
    .map(({ id, name, config }) => ({ id, name, host: typeof config.host === "string" ? config.host : undefined }));
}

type AgentFormContainerProps = {
  onCancel: () => void;
  onSaved: (agent: Agent, outcome: SaveOutcome) => void;
};

/**
 * Container of the "Add agent" dialog: loads the Langfuse connections and creates the agent.
 * Mounted only while its dialog is open, so every opening starts with clean mutation state.
 * Existing agents are edited inline, in the page's detail.
 */
export function AgentFormContainer({ onCancel, onSaved }: AgentFormContainerProps) {
  const t = useT();
  const connections = useConnections();
  const save = useAgentSave(undefined, onSaved);

  if (connections.isPending) return <Spinner label={t("connections.loading")} />;

  return (
    <AgentForm
      langfuseOptions={langfuseOptionsOf(connections.data)}
      langfuseHint={connections.isError ? t("agents.langfuseUnavailable") : undefined}
      onSubmit={save.onSubmit}
      onCancel={onCancel}
      pending={save.pending}
      error={save.error}
      serverFieldErrors={save.fieldErrors}
    />
  );
}
