"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { LaunchRunsDialog } from "@/features/runs/LaunchRunsDialog";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, Button, EmptyState, PlusIcon, ScenariosIcon, Spinner, buttonClasses, cn, focusRing } from "@/ui";
import { GroupTable } from "./GroupTable";
import { useGroups, useScenarios } from "./queries";
import type { Scenario } from "./types";

const NO_AGENT_HINT_ID = "new-scenario-needs-agent";

/**
 * `/scenarios`: the scenario groups, one row each. A group's title opens it: its scenarios in a
 * sidebar beside its details. "New scenario" opens the editor on a new group, created on save.
 */
export function ScenariosContainer() {
  const t = useT();
  const router = useRouter();
  const groups = useGroups();
  const scenarios = useScenarios();
  const agents = useAgents();
  const [launching, setLaunching] = useState<Scenario[] | undefined>(undefined);

  const agentList = agents.data ?? [];
  const noAgents = agents.isSuccess && agentList.length === 0;

  // A new scenario outside any group starts a new group (titled in the editor).
  const newScenario = noAgents ? (
    <Button icon={<PlusIcon size={16} />} disabled aria-describedby={NO_AGENT_HINT_ID}>
      {t("scenarios.new")}
    </Button>
  ) : (
    <Link href="/scenarios/new" className={buttonClasses("primary")}>
      <PlusIcon size={16} />
      {t("scenarios.new")}
    </Link>
  );
  // Opens a new scenario with the import panel (see ScenarioEditor); hidden until an agent exists.
  const importScenario = noAgents ? null : (
    <Link href="/scenarios/new#import" className={buttonClasses("secondary")}>
      {t("transfer.import")}
    </Link>
  );

  let body;
  if (groups.isPending) {
    body = <Spinner label={t("scenarios.loading")} />;
  } else if (groups.isError) {
    body = (
      <Alert title={t("groups.loadFailed")}>
        <span className="block">{errorMessage(groups.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => groups.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (groups.data.length === 0) {
    body = (
      <EmptyState
        icon={<ScenariosIcon size={22} />}
        title={t("groups.emptyTitle")}
        description={t("groups.emptyDescription")}
        action={newScenario}
      />
    );
  } else {
    const loaded = scenarios.data;
    body = (
      <>
        {scenarios.isError && !loaded ? (
          <Alert title={t("groups.scenariosFailed")}>
            <span className="block">{errorMessage(scenarios.error)}</span>
            <Button variant="secondary" className="mt-3" onClick={() => scenarios.refetch()}>
              {t("common.tryAgain")}
            </Button>
          </Alert>
        ) : null}
        <GroupTable
          groups={groups.data}
          // Only once the scenarios are known: a launch must never open with an empty batch.
          // They are the ones the group holds now, newest first like the API lists them.
          onLaunch={
            loaded ? (group) => setLaunching(loaded.filter((scenario) => scenario.groupId === group.id)) : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t("nav.scenarios")}
        description={t("scenarios.description")}
        actions={
          <>
            {importScenario}
            {newScenario}
          </>
        }
      />
      {noAgents ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <p id={NO_AGENT_HINT_ID}>{t("scenarios.noAgentHint")}</p>
          <Link href="/agents" className={cn("rounded", focusRing)}>
            {t("scenarios.addAgent")}
          </Link>
        </div>
      ) : null}
      {body}

      <LaunchRunsDialog
        open={launching !== undefined}
        scenarios={(launching ?? []).map(({ id, name, agentId, endConditions }) => ({
          id,
          name,
          maxDurationS: endConditions.maxDurationS,
          kind: agentList.find((agent) => agent.id === agentId)?.kind,
        }))}
        onClose={() => setLaunching(undefined)}
        onLaunched={(batch) => router.push(`/live?batchId=${encodeURIComponent(batch.id)}`)}
      />
    </>
  );
}
