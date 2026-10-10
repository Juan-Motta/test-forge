"use client";

import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { ApiError, errorMessage } from "@/lib/api";
import { AgentsIcon, Alert, Button, Dialog, EmptyState, PlusIcon, Spinner } from "@/ui";
import { AgentFormContainer } from "./AgentFormContainer";
import { AgentsTable } from "./AgentsTable";
import { DeleteAgentDialog } from "./DeleteAgentDialog";
import { useAgents, useDeleteAgent } from "./queries";
import type { Agent } from "./types";

type Editing = { type: "create" } | { type: "edit"; agent: Agent };

type AgentsContainerProps = {
  /** Scenarios per agent id, shown as a column when known. */
  scenarioCounts?: ReadonlyMap<string, number>;
};

/** Container for `/agents`: list, create/edit dialog and deletion. */
export function AgentsContainer({ scenarioCounts }: AgentsContainerProps = {}) {
  const agents = useAgents();
  const remove = useDeleteAgent();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Agent | undefined>(undefined);
  // Persistent polite live region: announces outcomes that otherwise only change the list.
  const [notice, setNotice] = useState("");
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const deletingNow = useRef(false);
  // The deleted row's button had focus; once the dialog is gone, hand focus to the page title.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);

  useEffect(() => {
    if (!focusTitle.current || deleting) return;
    focusTitle.current = false;
    titleRef.current?.focus();
  });

  const openCreate = () => setEditing({ type: "create" });

  function confirmDelete(agent: Agent) {
    if (deletingNow.current) return;
    deletingNow.current = true;
    remove.mutate(agent, {
      onSuccess: () => {
        focusTitle.current = true;
        setDeleting(undefined);
        setNotice(`Deleted ${agent.name}.`);
      },
      onSettled: () => (deletingNow.current = false),
    });
  }

  function onSaved(agent: Agent) {
    setNotice(editing?.type === "create" ? `Created ${agent.name}.` : `Saved ${agent.name}.`);
    setEditing(null);
  }

  const inUse = remove.error instanceof ApiError && remove.error.status === 409;
  const list = agents.data ?? [];
  let body;
  if (agents.isPending) {
    body = <Spinner label="Loading agents" />;
  } else if (agents.isError) {
    body = (
      <Alert title="Could not load agents">
        <span className="block">{errorMessage(agents.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => agents.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon={<AgentsIcon size={22} />}
        title="No agents yet"
        description="Register the voice agents you want to evaluate: how to reach them over WebSocket and what they do. Scenarios are written against an agent."
        action={
          <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
            Add your first agent
          </Button>
        }
      />
    );
  } else {
    body = (
      <AgentsTable
        agents={list}
        scenarioCounts={scenarioCounts}
        onEdit={(agent) => setEditing({ type: "edit", agent })}
        onDelete={(agent) => {
          remove.reset();
          setDeleting(agent);
        }}
      />
    );
  }

  return (
    <>
      <PageHeader
        titleRef={titleRef}
        title="Agents"
        description="The voice agents under test, how to reach them and what they do."
        actions={
          <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
            Add agent
          </Button>
        }
      />
      <p role="status" className="sr-only">
        {notice}
      </p>
      {body}

      <Dialog
        open={editing !== null}
        size="lg"
        title={editing?.type === "edit" ? `Edit ${editing.agent.name}` : "Add agent"}
        description="Every run reaches the agent with these settings and a fresh thread ID."
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <AgentFormContainer
            agent={editing.type === "edit" ? editing.agent : undefined}
            onCancel={() => setEditing(null)}
            onSaved={onSaved}
          />
        ) : null}
      </Dialog>

      <DeleteAgentDialog
        agent={deleting}
        onCancel={() => setDeleting(undefined)}
        onConfirm={confirmDelete}
        pending={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : undefined}
        errorHint={inUse ? "Delete or move its scenarios first." : undefined}
      />
    </>
  );
}
