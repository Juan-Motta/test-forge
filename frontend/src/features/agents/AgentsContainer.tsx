"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useConnections } from "@/features/connections/queries";
import { PageHeader } from "@/features/shell/PageHeader";
import { ApiError, errorMessage } from "@/lib/api";
import { confirmLeave, useUnsavedChangesGuard } from "@/lib/navigation/unsaved-changes";
import { AgentsIcon, Alert, Button, Card, Dialog, EmptyState, PlusIcon, Spinner, buttonClasses } from "@/ui";
import { AgentForm } from "./AgentForm";
import { AgentFormContainer, LANGFUSE_UNAVAILABLE_HINT, langfuseOptionsOf } from "./AgentFormContainer";
import { AgentsRail } from "./AgentsRail";
import { ConnectionCheck, IDLE_TEST, ReachabilityPill, type ConnectionTestState } from "./ConnectionCheck";
import { DeleteAgentDialog } from "./DeleteAgentDialog";
import { useAgents, useDeleteAgent, useTestAgentConnection } from "./queries";
import type { Agent } from "./types";
import { useAgentSave, type SaveOutcome } from "./use-agent-save";

/** The address names the open agent (`/agents?agent=<id>`), so a detail can be linked and reloaded. */
const AGENT_PARAM = "agent";

function agentFromAddress(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(AGENT_PARAM);
}

/** The native History API keeps Next's router in sync without a navigation. */
function writeAgentToAddress(id: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (id === null) params.delete(AGENT_PARAM);
  else params.set(AGENT_PARAM, id);
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

type AgentsContainerProps = {
  /** Scenarios per agent id, shown on the rail cards when known. */
  scenarioCounts?: ReadonlyMap<string, number>;
};

/**
 * Container for `/agents`: master/detail. The rail lists the agents; the detail edits the open
 * one inline, runs its connection test and deletes it. New agents are created in a dialog.
 */
export function AgentsContainer({ scenarioCounts }: AgentsContainerProps = {}) {
  const agents = useAgents();
  const connections = useConnections();
  const remove = useDeleteAgent();
  const testConnection = useTestAgentConnection();
  const formId = useId();
  const [requestedId, setRequestedId] = useState<string | null>(agentFromAddress);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Agent | undefined>(undefined);
  // Connection tests run in this session, by agent id; nothing is stored server-side.
  const [tests, setTests] = useState<Record<string, ConnectionTestState>>({});
  const testingNow = useRef(new Set<string>());
  // Persistent polite live region: announces outcomes that otherwise only change the page.
  const [notice, setNotice] = useState("");
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const deletingNow = useRef(false);
  // Mirrors `deletingNow` for rendering: one delete at a time, even across dialogs.
  const [deleteInFlight, setDeleteInFlight] = useState(false);
  const shownDelete = useRef<Agent | undefined>(undefined);
  // The Delete button had focus; once the dialog is gone, hand focus to the page title.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);
  // The open agent's form holds unsaved edits: switching agents (or leaving the page) asks first.
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty);
  // Bumped per agent after a successful save: the form remounts on what is stored now. A
  // background refetch alone never remounts it, so it never discards edits.
  const [formVersions, setFormVersions] = useState<Record<string, number>>({});

  const list = agents.data ?? [];
  const selected = list.find((agent) => agent.id === requestedId) ?? list[0];
  const save = useAgentSave(selected, onSaved);

  useEffect(() => {
    if (!focusTitle.current || deleting) return;
    focusTitle.current = false;
    titleRef.current?.focus();
  });

  function select(id: string) {
    if (id === selected?.id) return;
    if (!confirmLeave()) return;
    save.reset();
    setRequestedId(id);
    writeAgentToAddress(id);
  }

  function onSaved(agent: Agent, outcome: SaveOutcome) {
    if (outcome === "created") {
      setNotice(`Created ${agent.name}.`);
      setCreating(false);
      setRequestedId(agent.id);
      writeAgentToAddress(agent.id);
    } else {
      setNotice(outcome === "saved" ? `Saved ${agent.name}.` : "No changes to save.");
      if (outcome === "saved") setFormVersions((current) => ({ ...current, [agent.id]: (current[agent.id] ?? 0) + 1 }));
    }
  }

  async function runTest(agent: Agent) {
    if (testingNow.current.has(agent.id)) return;
    testingNow.current.add(agent.id);
    setTests((current) => ({ ...current, [agent.id]: { status: "running" } }));
    setNotice("");
    try {
      const result = await testConnection.mutateAsync(agent);
      setTests((current) => ({ ...current, [agent.id]: { status: "done", result, checkedAt: new Date() } }));
      setNotice(`${agent.name} is ${result.reachable ? "reachable" : "unreachable"}.`);
    } catch (error) {
      setTests((current) => ({ ...current, [agent.id]: { status: "error", message: errorMessage(error) } }));
    } finally {
      testingNow.current.delete(agent.id);
    }
  }

  /** Opens or closes the dialog; the ref lets a settling delete see what the dialog shows now. */
  function showDelete(agent: Agent | undefined) {
    shownDelete.current = agent;
    setDeleting(agent);
  }

  async function confirmDelete(agent: Agent) {
    if (deletingNow.current) return;
    deletingNow.current = true;
    setDeleteInFlight(true);
    try {
      await remove.mutateAsync(agent);
      setNotice(`Deleted ${agent.name}.`);
      if (agentFromAddress() === agent.id) writeAgentToAddress(null);
      // The user may have cancelled and opened another agent's dialog meanwhile: leave that one open.
      if (shownDelete.current?.id === agent.id) {
        focusTitle.current = true;
        showDelete(undefined);
      }
    } catch {
      // Shown through the mutation's error state while its dialog is open.
    } finally {
      // mutateAsync, not mutate's onSettled: `remove.reset()` drops pending mutate callbacks.
      deletingNow.current = false;
      setDeleteInFlight(false);
    }
  }

  const openCreate = () => setCreating(true);
  const addButton = (
    <Button variant={selected ? "secondary" : "primary"} icon={<PlusIcon size={16} />} onClick={openCreate}>
      Add agent
    </Button>
  );

  const inUse = remove.error instanceof ApiError && remove.error.status === 409;
  let header;
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
  } else if (!selected) {
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
    const test = tests[selected.id] ?? IDLE_TEST;
    header = (
      <PageHeader
        titleRef={titleRef}
        eyebrow="Agents"
        title={selected.name}
        actions={
          <>
            {addButton}
            <Button
              variant="ghost"
              aria-label={`Delete ${selected.name}`}
              onClick={() => {
                remove.reset();
                showDelete(selected);
              }}
            >
              Delete
            </Button>
            <Button type="submit" form={formId} loading={save.pending}>
              {save.pending ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      />
    );
    body = (
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <AgentsRail
          agents={list}
          selectedId={selected.id}
          onSelect={(agent) => select(agent.id)}
          scenarioCounts={scenarioCounts}
          tests={tests}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {connections.isPending ? (
            <Spinner label="Loading connections" />
          ) : (
            <AgentForm
              // A fresh form per agent and after each of its saves; not on a background refetch.
              key={`${selected.id}:${formVersions[selected.id] ?? 0}`}
              layout="cards"
              formId={formId}
              agent={selected}
              langfuseOptions={langfuseOptionsOf(connections.data)}
              langfuseHint={connections.isError ? LANGFUSE_UNAVAILABLE_HINT : undefined}
              onSubmit={save.onSubmit}
              pending={save.pending}
              error={save.error}
              serverFieldErrors={save.fieldErrors}
              connectionStatus={<ReachabilityPill state={test} />}
              connectionCheck={<ConnectionCheck state={test} onRun={() => void runTest(selected)} />}
              extraCards={<EvaluatorNote />}
              onDirtyChange={setDirty}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {header ?? (
        <PageHeader
          titleRef={titleRef}
          title="Agents"
          description="The voice agents under test, how to reach them and what they do."
          actions={addButton}
        />
      )}
      <p role="status" className="sr-only">
        {notice}
      </p>
      {body}

      <Dialog
        open={creating}
        size="lg"
        title="Add agent"
        description="Every run reaches the agent with these settings and a fresh thread ID."
        onClose={() => setCreating(false)}
      >
        {creating ? <AgentFormContainer onCancel={() => setCreating(false)} onSaved={onSaved} /> : null}
      </Dialog>

      <DeleteAgentDialog
        agent={deleting}
        onCancel={() => showDelete(undefined)}
        onConfirm={confirmDelete}
        pending={deleteInFlight}
        error={remove.isError ? errorMessage(remove.error) : undefined}
        errorHint={inUse ? "Delete or move its scenarios first." : undefined}
      />
    </>
  );
}

/** Evaluator and judge settings live on each scenario; this card says so instead of duplicating them. */
function EvaluatorNote() {
  const headingId = useId();
  return (
    <Card aria-labelledby={headingId} className="gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-[15px] font-semibold">
          Evaluator and judge
        </h2>
        <p className="text-xs text-dim">Set per scenario, not per agent</p>
      </div>
      <p className="text-sm text-muted">
        Each scenario chooses how the evaluator speaks (speech-to-speech or STT → LLM → TTS), its voice and the
        connections it uses, and the judge scores every run against that scenario&apos;s criteria.
      </p>
      <div>
        <Link href="/scenarios" className={buttonClasses("secondary")}>
          Open scenarios
        </Link>
      </div>
    </Card>
  );
}
