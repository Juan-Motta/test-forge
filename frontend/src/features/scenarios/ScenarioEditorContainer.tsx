"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agents/queries";
import type { AgentKind } from "@/features/agents/types";
import { canChat } from "@/features/connections/kinds";
import { LaunchPanel } from "@/features/runs/LaunchPanel";
import { useConnections } from "@/features/connections/queries";
import { PageHeader } from "@/features/shell/PageHeader";
import { ApiError, errorMessage, formErrorView } from "@/lib/api";
import { confirmLeave, useUnsavedChangesGuard } from "@/lib/navigation/unsaved-changes";
import { Alert, Button, Card, EmptyState, ScenariosIcon, Spinner, buttonClasses } from "@/ui";
import { toChanges, toNewScenario, type ScenarioFormValues } from "./form-schema";
import { useCreateScenario, useDuplicateScenario, useScenario, useScenarios, useUpdateScenario } from "./queries";
import { ScenarioEditor, type ConnectionOption } from "./ScenarioEditor";
import { ScenarioLibraryRail } from "./ScenarioLibraryRail";
import type { Scenario } from "./types";

export const LAUNCH_LEAVE_MESSAGE = "Runs are still being launched. Leave this page anyway? You will not be taken to their live view.";
export const DUPLICATE_SCENARIO_NAME = "A scenario with this name already exists for this agent.";
const TTS_KINDS = new Set(["openai", "azure_openai"]);

/** A load failed before any data arrived; a failed background refetch keeps the editor (and its edits). */
function loadFailed(query: { isError: boolean; data: unknown }): boolean {
  return query.isError && query.data === undefined;
}

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
  const library = useScenarios();
  const duplicate = useDuplicateScenario();
  const duplicatingNow = useRef(false);
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const saving = useRef(false);
  const save = scenarioId ? update : create;
  // While the rail is launching, leaving would drop the launch's result (the batch to open).
  const [launching, setLaunching] = useState(false);
  useUnsavedChangesGuard(launching, LAUNCH_LEAVE_MESSAGE);

  // Memoized per failure: a new `fieldErrors` object tells the editor to show a new set of errors.
  const view = useMemo(
    () => (save.error ? formErrorView(save.error, DUPLICATE_SCENARIO_NAME) : undefined),
    [save.error],
  );

  async function onSubmit(values: ScenarioFormValues, kind: AgentKind): Promise<Scenario | undefined> {
    if (saving.current) return undefined;
    saving.current = true;
    create.reset();
    update.reset();
    try {
      const current = scenario.data;
      if (current) {
        const changes = toChanges(current, values, kind);
        return Object.keys(changes).length === 0 ? current : await update.mutateAsync({ id: current.id, changes });
      }
      const created = await create.mutateAsync(toNewScenario(values, kind));
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

  function onDuplicate() {
    const current = scenario.data;
    // The copy is made from the saved version; leaving would drop unsaved edits.
    if (!current || duplicatingNow.current || !confirmLeave()) return;
    duplicatingNow.current = true;
    duplicate.mutate(current, {
      onSuccess: (copy) => router.push(`/scenarios/${encodeURIComponent(copy.id)}`),
      onSettled: () => (duplicatingNow.current = false),
    });
  }

  const title = scenarioId ? (scenario.data?.name ?? "Scenario") : "New scenario";
  const tag = scenario.data?.tags[0];
  const eyebrow = (
    <nav aria-label="Breadcrumb">
      <Link href="/scenarios" onNavigate={(event) => (confirmLeave() ? undefined : event.preventDefault())}>
        Scenarios
      </Link>
      {tag ? (
        <>
          <span aria-hidden="true"> / </span>
          <span>{tag}</span>
        </>
      ) : null}
      <span aria-hidden="true"> / </span>
      <span aria-current="page">{title}</span>
    </nav>
  );
  const header = <PageHeader title={title} eyebrow={eyebrow} />;

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
  } else if (
    loadFailed(scenario) ||
    loadFailed(agents) ||
    loadFailed(connections)
  ) {
    // Without connections the voice and model selects would silently offer nothing.
    const failed = loadFailed(scenario) ? scenario : loadFailed(agents) ? agents : connections;
    const what = loadFailed(scenario)
      ? "the scenario"
      : loadFailed(agents)
        ? "agents"
        : "connections";
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
        title={title}
        eyebrow={eyebrow}
        onDuplicate={scenario.data ? onDuplicate : undefined}
        duplicating={duplicate.isPending}
        banner={duplicate.isError ? <Alert>{`Could not duplicate: ${errorMessage(duplicate.error)}`}</Alert> : null}
        library={
          <ScenarioLibraryRail
            scenarios={library.data?.filter((item) => !scenario.data || item.agentId === scenario.data.agentId)}
            failed={loadFailed(library)}
            currentId={scenario.data?.id}
          />
        }
        launch={
          <LaunchRail
            scenario={scenario.data}
            agentKind={agents.data?.find((agent) => agent.id === scenario.data?.agentId)?.kind}
            onLaunched={(batchId) => router.push(`/live?batchId=${encodeURIComponent(batchId)}`)}
            onBusyChange={setLaunching}
          />
        }
      />
    );
    return body;
  }

  return (
    <>
      {header}
      {body}
    </>
  );
}

/** Right rail: launches the saved scenario; a new one has to be saved first. */
function LaunchRail({
  scenario,
  agentKind,
  onLaunched,
  onBusyChange,
}: {
  scenario: Scenario | undefined;
  /** The scenario's agent kind, once known: text runs are conversations. */
  agentKind?: AgentKind;
  onLaunched: (batchId: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  // A panel unmounted mid-launch never reports the end of it; do not leave the page guarded.
  // `onBusyChange` is a state setter, so this runs on unmount only.
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  if (!scenario) {
    return (
      <aside aria-label="Launch" className="flex min-w-0 flex-col">
        <Card className="gap-2">
          <h2 className="text-[15px] font-semibold">Launch a batch</h2>
          <p className="text-sm text-muted">Save the scenario to launch runs.</p>
        </Card>
      </aside>
    );
  }
  return (
    <aside aria-label="Launch" className="flex min-w-0 flex-col">
      <section
        aria-labelledby="launch-batch-heading"
        className="flex flex-col gap-4 rounded-xl border border-evaluator-line bg-panel p-5"
      >
        <div className="flex flex-col gap-1">
          <h2 id="launch-batch-heading" className="text-[15px] font-semibold">
            Launch a batch
          </h2>
          <p className="text-xs text-dim">Launches the saved version.</p>
        </div>
        <LaunchPanel
          scenarios={[
            {
              id: scenario.id,
              name: scenario.name,
              maxDurationS: scenario.endConditions.maxDurationS,
              kind: agentKind,
            },
          ]}
          onLaunched={(batch) => onLaunched(batch.id)}
          onBusyChange={onBusyChange}
        />
      </section>
    </aside>
  );
}
