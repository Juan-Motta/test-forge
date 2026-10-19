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
import { AgentScenarioTable, scenariosByAgent } from "./AgentScenarioTable";
import { useScenarios } from "./queries";
import type { Scenario } from "./types";

const NO_AGENT_HINT_ID = "new-scenario-needs-agent";

/**
 * `/scenarios`: one row per agent with how many scenarios it has. An agent's name opens its
 * newest scenario, whose editor lists the agent's whole library beside it.
 */
export function ScenariosContainer() {
  const t = useT();
  const router = useRouter();
  const scenarios = useScenarios();
  const agents = useAgents();
  const [launching, setLaunching] = useState<Scenario[] | undefined>(undefined);

  const agentList = agents.data ?? [];
  const noAgents = agents.isSuccess && agentList.length === 0;

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

  const list = scenarios.data ?? [];
  let body;
  if (scenarios.isPending || agents.isPending) {
    body = <Spinner label={t("scenarios.loading")} />;
  } else if (scenarios.isError || agents.isError) {
    const failed = scenarios.isError ? scenarios : agents;
    body = (
      <Alert title={t("scenarios.loadFailed")}>
        <span className="block">{errorMessage(failed.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => failed.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon={<ScenariosIcon size={22} />}
        title={t("scenarios.emptyTitle")}
        description={t("scenarios.emptyDescription")}
        action={newScenario}
      />
    );
  } else {
    body = (
      <AgentScenarioTable rows={scenariosByAgent(agentList, list)} onLaunchAll={(row) => setLaunching(row.scenarios)} />
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
