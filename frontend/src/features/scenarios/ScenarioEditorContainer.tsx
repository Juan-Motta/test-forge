"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAgents } from "@/features/agents/queries";
import type { AgentKind } from "@/features/agents/types";
import { canChat, canVoice, connectionVoices } from "@/features/connections/kinds";
import { LaunchPanel } from "@/features/runs/LaunchPanel";
import { useConnections } from "@/features/connections/queries";
import type { Crumb } from "@/features/shell/Breadcrumbs";
import { PageHeader } from "@/features/shell/PageHeader";
import { ApiError, errorMessage, formErrorView } from "@/lib/api";
import { localizeFormError, useT } from "@/lib/i18n";
import { confirmLeave, useUnsavedChangesGuard } from "@/lib/navigation/unsaved-changes";
import { Alert, Button, Card, EmptyState, ScenariosIcon, Spinner, buttonClasses } from "@/ui";
import { toChanges, toNewScenario, type ScenarioFormValues } from "./form-schema";
import { DeleteScenarioDialog } from "./DeleteScenarioDialog";
import { EditableTitle } from "./EditableTitle";
import {
  useCreateGroup,
  useCreateScenario,
  useDeleteGroup,
  useDeleteScenario,
  useDuplicateScenario,
  useGroups,
  useUpdateGroup,
  useScenario,
  useScenarios,
  useUpdateScenario,
} from "./queries";
import { ScenarioEditor, type ConnectionOption } from "./ScenarioEditor";
import { ScenarioLibraryRail } from "./ScenarioLibraryRail";
import { scenarioFromText, scenarioToText } from "./transfer";
import type { Scenario, ScenarioGroup } from "./types";


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
  const t = useT();
  const router = useRouter();
  const scenario = useScenario(scenarioId);
  const agents = useAgents();
  const connections = useConnections();
  const create = useCreateScenario();
  const update = useUpdateScenario();
  const library = useScenarios();
  const groups = useGroups();
  const duplicate = useDuplicateScenario();
  const remove = useDeleteScenario();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const [newGroupTitle, setNewGroupTitle] = useState("");
  const [groupError, setGroupError] = useState<string>();
  const [deleting, setDeleting] = useState<Scenario | undefined>(undefined);
  const duplicatingNow = useRef(false);
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const saving = useRef(false);
  const save = scenarioId ? update : create;
  // While the rail is launching, leaving would drop the launch's result (the batch to open).
  const [launching, setLaunching] = useState(false);
  useUnsavedChangesGuard(launching, t("scenarios.leaveWhileLaunching"));

  // Memoized per failure: a new `fieldErrors` object tells the editor to show a new set of errors.
  const view = useMemo(
    () =>
      save.error
        ? localizeFormError(t, save.error, formErrorView(save.error, t("scenarios.duplicateName")))
        : undefined,
    [save.error, t],
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
      // Outside any group, the scenario starts a new one: titled as typed above, or after the
      // scenario. Created first so the scenario can join it; removed again if the scenario fails.
      let newGroup: ScenarioGroup | undefined;
      if (!values.groupId) {
        setGroupError(undefined);
        try {
          newGroup = await createGroup.mutateAsync({
            name: newGroupTitle.trim() || values.name.trim(),
            description: "",
            tags: [],
          });
        } catch (error) {
          setGroupError(
            error instanceof ApiError && error.status === 409 ? t("groups.error.takenNew") : errorMessage(error),
          );
          return undefined;
        }
      }
      try {
        const payload = toNewScenario(newGroup ? { ...values, groupId: newGroup.id } : values, kind);
        const created = await create.mutateAsync(payload);
        router.replace(`/scenarios/${encodeURIComponent(created.id)}`);
        return created;
      } catch (error) {
        if (newGroup) deleteGroup.mutate(newGroup);
        throw error;
      }
    } catch {
      return undefined; // shown through the mutation's error state
    } finally {
      saving.current = false;
    }
  }

  function onCancel() {
    if (confirmLeave()) router.push("/scenarios");
  }

  // Deleting the open scenario moves to its group's next one (the group stays in view), or back
  // to Scenarios after its last one.
  // mutateAsync, not mutate's onSuccess: reopening the dialog calls `remove.reset()`, which
  // drops pending mutate callbacks, and the page must still move on once the delete lands.
  async function confirmDelete(current: Scenario) {
    if (remove.isPending) return;
    try {
      await remove.mutateAsync(current);
    } catch {
      return; // shown through the mutation's error state while the dialog is open
    }
    setDeleting(undefined);
    const next = library.data?.find((item) => item.groupId === current.groupId && item.id !== current.id);
    router.push(next ? `/scenarios/${encodeURIComponent(next.id)}` : "/scenarios");
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

  const leave: Crumb["onNavigate"] = (event) => (confirmLeave() ? undefined : event.preventDefault());
  // The group in view: the scenario's, or the one a new scenario was opened in (`?group=`); its
  // name from the groups list, which a rename refreshes first.
  const requestedGroup = scenarioId ? undefined : requestedId("group", groups.data ?? []);
  const groupId = scenario.data?.groupId ?? requestedGroup;
  const groupInView = groups.data?.find((group) => group.id === groupId) ?? scenario.data?.group;
  const breadcrumbs: Crumb[] = [{ label: t("nav.scenarios"), href: "/scenarios", onNavigate: leave }];
  // The page is titled by the group (renamed in place with the pencil); a new scenario outside
  // any group starts a blank one, whose title is kept here until the first save creates it.
  const title = groupInView ? (
    <EditableTitle
      value={groupInView.name}
      placeholder={t("groups.untitled")}
      label={t("groups.rename", { name: groupInView.name })}
      onCommit={async (next) => {
        if (!next) return t("groups.error.title");
        try {
          await updateGroup.mutateAsync({ id: groupInView.id, changes: { name: next } });
          return undefined;
        } catch (error) {
          return error instanceof ApiError && error.status === 409 ? t("groups.error.taken") : errorMessage(error);
        }
      }}
    />
  ) : scenarioId ? (
    t("scenarios.one")
  ) : (
    <EditableTitle
      value={newGroupTitle}
      placeholder={t("scenarios.new")}
      label={t("groups.nameNew")}
      onCommit={(next) => {
        setNewGroupTitle(next);
        setGroupError(undefined);
        return undefined;
      }}
    />
  );
  const header = <PageHeader title={title} breadcrumbs={breadcrumbs} />;

  let body;
  if (scenario.isError && scenario.error instanceof ApiError && scenario.error.status === 404) {
    return (
      <EmptyState
        icon={<ScenariosIcon size={22} />}
        title={t("scenarios.notFound")}
        description={t("scenarios.notFoundHint")}
        action={
          <Link href="/scenarios" className={buttonClasses("secondary")}>
            {t("scenarios.back")}
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
    const failedTitle = loadFailed(scenario)
      ? t("scenarios.loadOneFailed")
      : loadFailed(agents)
        ? t("agents.loadFailed")
        : t("connections.loadFailed");
    body = (
      <Alert title={failedTitle}>
        <span className="block">{errorMessage(failed.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => failed.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if ((scenarioId && scenario.isPending) || agents.isPending || connections.isPending || groups.isPending) {
    body = <Spinner label={t("scenarios.loadingEditor")} />;
  } else if (!scenarioId && (agents.data ?? []).length === 0) {
    body = (
      <EmptyState
        icon={<ScenariosIcon size={22} />}
        title={t("scenarios.addAgentFirst")}
        description={t("scenarios.addAgentFirstHint")}
        action={
          <Link href="/agents" className={buttonClasses("primary")}>
            {t("scenarios.goToAgents")}
          </Link>
        }
      />
    );
  } else {
    const ttsOptions: ConnectionOption[] = (connections.data ?? [])
      .filter(canVoice)
      .map((connection) => ({ id: connection.id, name: connection.name, voices: connectionVoices(connection) }));
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
        breadcrumbs={breadcrumbs}
        onDuplicate={scenario.data ? onDuplicate : undefined}
        onDelete={
          scenario.data
            ? () => {
                // A delete in flight keeps its state (and its pending label) when the dialog reopens.
                if (!remove.isPending) remove.reset();
                setDeleting(scenario.data);
              }
            : undefined
        }
        defaultAgentId={scenarioId ? undefined : requestedId("agent", agents.data ?? [])}
        defaultGroupId={requestedGroup}
        groups={groups.data ?? []}
        duplicating={duplicate.isPending}
        // Only once the connections are known, so their names are never silently left out.
        exportText={scenario.data && connections.isSuccess ? scenarioToText(scenario.data, connections.data) : undefined}
        importConfig={
          scenarioId
            ? undefined
            : (text) =>
                scenarioFromText(t, text, agents.data ?? [], connections.data ?? [], agents.data?.[0]?.id, groups.data ?? [])
        }
        banner={
          <>
            {duplicate.isError ? (
              <Alert>{t("scenarios.duplicateFailed", { error: errorMessage(duplicate.error) })}</Alert>
            ) : null}
            {groupError ? <Alert>{groupError}</Alert> : null}
          </>
        }
        library={
          groupInView || scenarioId ? (
            <ScenarioLibraryRail
              scenarios={library.data?.filter((item) => !groupInView || item.groupId === groupInView.id)}
              failed={loadFailed(library)}
              currentId={scenario.data?.id}
              group={groupInView}
            />
          ) : (
            <NewGroupRail />
          )
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
    return (
      <>
        {body}
        <DeleteScenarioDialog
          scenario={deleting}
          onCancel={() => setDeleting(undefined)}
          onConfirm={confirmDelete}
          pending={remove.isPending}
          error={remove.isError ? errorMessage(remove.error) : undefined}
        />
      </>
    );
  }

  return (
    <>
      {header}
      {body}
    </>
  );
}

/**
 * The agent (`?agent=<id>`) or group (`?group=<id>`) a new scenario was opened for, when it
 * exists. Read in the browser only; on the server there is no request URL here.
 */
function requestedId(param: "agent" | "group", records: { id: string }[]): string | undefined {
  if (typeof window === "undefined") return undefined;
  const id = new URLSearchParams(window.location.search).get(param);
  return records.some((record) => record.id === id) ? (id ?? undefined) : undefined;
}

/** Left rail of a new group: a placeholder until its first scenario is saved. */
function NewGroupRail() {
  const t = useT();
  return (
    <aside aria-label={t("library.label")} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-line-strong p-4">
        <p className="text-[13px] font-medium">{t("groups.newRailTitle")}</p>
        <p className="text-xs text-muted">{t("groups.newRailHint")}</p>
      </div>
      {[0, 1, 2].map((row) => (
        <span key={row} aria-hidden="true" className="flex h-11 flex-col justify-center gap-1.5 rounded-lg px-3 opacity-60">
          <span className="h-3 w-4/5 rounded bg-chip" />
          <span className="h-2.5 w-1/3 rounded bg-chip" />
        </span>
      ))}
    </aside>
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
  const t = useT();
  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  if (!scenario) {
    return (
      <aside aria-label={t("scenarios.launch")} className="flex min-w-0 flex-col">
        <Card className="gap-2">
          <h2 className="text-[15px] font-semibold">{t("scenarios.launchBatch")}</h2>
          <p className="text-sm text-muted">{t("scenarios.saveToLaunch")}</p>
        </Card>
      </aside>
    );
  }
  return (
    <aside aria-label={t("scenarios.launch")} className="flex min-w-0 flex-col">
      <section
        aria-labelledby="launch-batch-heading"
        className="flex flex-col gap-4 rounded-xl border border-evaluator-line bg-panel p-5"
      >
        <div className="flex flex-col gap-1">
          <h2 id="launch-batch-heading" className="text-[15px] font-semibold">
            {t("scenarios.launchBatch")}
          </h2>
          <p className="text-xs text-dim">{t("scenarios.launchesSaved")}</p>
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
