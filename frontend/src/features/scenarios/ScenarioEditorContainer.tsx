"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { canChat } from "@/features/connections/kinds";
import { LaunchRunsDialog } from "@/features/runs/LaunchRunsDialog";
import { useConnections } from "@/features/connections/queries";
import { PageHeader } from "@/features/shell/PageHeader";
import { ApiError, errorMessage, formErrorView } from "@/lib/api";
import { confirmLeave } from "@/lib/navigation/unsaved-changes";
import { Alert, Button, EmptyState, ScenariosIcon, Spinner, buttonClasses } from "@/ui";
import { toChanges, toNewScenario, type ScenarioFormValues } from "./form-schema";
import { useCreateScenario, useScenario, useUpdateScenario } from "./queries";
import { ScenarioEditor, type ConnectionOption } from "./ScenarioEditor";
import type { Scenario } from "./types";

export const DUPLICATE_SCENARIO_NAME = "A scenario with this name already exists for this agent.";
const TTS_KINDS = new Set(["openai", "azure_openai"]);

type ScenarioEditorContainerProps = {
  /** Present on `/scenarios/[id]`; absent on `/scenarios/new`. */
  scenarioId?: string;
};

/**
 * Container for the scenario editor: loads the scenario, agents and connections, and saves
 * (create, or PATCH with only the changed top-level fields).
 */
export function ScenarioEditorContainer({ scenarioId }: ScenarioEditorContainerProps) {
  const router = useRouter();
  const scenario = useScenario(scenarioId);
  const agents = useAgents();
  const connections = useConnections();
  const create = useCreateScenario();
  const update = useUpdateScenario();
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const saving = useRef(false);
  const save = scenarioId ? update : create;
  const [launching, setLaunching] = useState(false);

  // Memoized per failure: a new `fieldErrors` object tells the editor to show a new set of errors.
  const view = useMemo(
    () => (save.error ? formErrorView(save.error, DUPLICATE_SCENARIO_NAME) : undefined),
    [save.error],
  );

  async function onSubmit(values: ScenarioFormValues): Promise<Scenario | undefined> {
    if (saving.current) return undefined;
    saving.current = true;
    create.reset();
    update.reset();
    try {
      const current = scenario.data;
      if (current) {
        const changes = toChanges(current, values);
        return Object.keys(changes).length === 0 ? current : await update.mutateAsync({ id: current.id, changes });
      }
      const created = await create.mutateAsync(toNewScenario(values));
      router.replace(`/scenarios/${encodeURIComponent(created.id)}`);
      return created;
    } catch {
      return undefined; // shown through the mutation's error state
    } finally {
      saving.current = false;
    }
  }

  function onCancel() {
    if (confirmLeave()) router.push("/scenarios");
  }

  const title = scenarioId ? (scenario.data?.name ?? "Scenario") : "New scenario";
  const header = (
    <PageHeader
      title={title}
      description={
        scenarioId
          ? `Scenario for ${scenario.data?.agent.name ?? "an agent"}.`
          : "What the simulated caller is, knows and wants, and how the call is judged."
      }
      actions={
        scenario.data ? (
          <Button variant="secondary" onClick={() => setLaunching(true)} title="Launches the saved version">
            Launch runs
          </Button>
        ) : undefined
      }
    />
  );

  let body;
  if (scenario.isError && scenario.error instanceof ApiError && scenario.error.status === 404) {
    return (
      <EmptyState
        icon={<ScenariosIcon size={22} />}
        title="Scenario not found"
        description="It may have been deleted, or the link is wrong."
        action={
          <Link href="/scenarios" className={buttonClasses("secondary")}>
            Back to scenarios
          </Link>
        }
      />
    );
  } else if (scenario.isError || agents.isError || connections.isError) {
    // Without connections the voice and model selects would silently offer nothing.
    const failed = scenario.isError ? scenario : agents.isError ? agents : connections;
    const what = scenario.isError ? "the scenario" : agents.isError ? "agents" : "connections";
    body = (
      <Alert title={`Could not load ${what}`}>
        <span className="block">{errorMessage(failed.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => failed.refetch()}>
          Try again
        </Button>
      </Alert>
    );
  } else if ((scenarioId && scenario.isPending) || agents.isPending || connections.isPending) {
    body = <Spinner label="Loading scenario editor" />;
  } else if (!scenarioId && (agents.data ?? []).length === 0) {
    body = (
      <EmptyState
        icon={<ScenariosIcon size={22} />}
        title="Add an agent first"
        description="Scenarios are written against an agent under test."
        action={
          <Link href="/agents" className={buttonClasses("primary")}>
            Go to agents
          </Link>
        }
      />
    );
  } else {
    const ttsOptions: ConnectionOption[] = (connections.data ?? [])
      .filter((connection) => TTS_KINDS.has(connection.kind))
      .map(({ id, name }) => ({ id, name }));
    const evaluatorOptions: ConnectionOption[] = (connections.data ?? [])
      .filter(canChat)
      .map(({ id, name }) => ({ id, name }));
    body = (
      <ScenarioEditor
        scenario={scenario.data}
        agents={agents.data ?? []}
        ttsOptions={ttsOptions}
        evaluatorOptions={evaluatorOptions}
        onSubmit={onSubmit}
        onCancel={onCancel}
        pending={save.isPending}
        error={view?.message}
        serverFieldErrors={view?.fieldErrors}
      />
    );
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/scenarios" onNavigate={(event) => (confirmLeave() ? undefined : event.preventDefault())}>
          Scenarios
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{title}</span>
      </nav>
      {header}
      {body}
      {scenario.data ? (
        <LaunchRunsDialog
          open={launching}
          scenarios={[{ id: scenario.data.id, name: scenario.data.name }]}
          onClose={() => setLaunching(false)}
          onLaunched={(batch) => router.push(`/live?batchId=${encodeURIComponent(batch.id)}`)}
        />
      ) : null}
    </>
  );
}
