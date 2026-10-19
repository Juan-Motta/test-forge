"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { LaunchRunsDialog } from "@/features/runs/LaunchRunsDialog";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, Button, Dialog, EmptyState, PlusIcon, ScenariosIcon, Spinner, buttonClasses, cn, focusRing } from "@/ui";
import { GroupForm } from "./GroupForm";
import { GroupTable, groupHref } from "./GroupTable";
import { useCreateGroup, useGroups, useScenarios } from "./queries";
import type { Scenario } from "./types";

const NEW_GROUP_FORM = "new-group-form";

/**
 * `/scenarios`: the scenario groups, one row each. A group's title opens it: its scenarios in a
 * sidebar beside its details. "New group" creates one and opens it.
 */
export function ScenariosContainer() {
  const t = useT();
  const router = useRouter();
  const groups = useGroups();
  const scenarios = useScenarios();
  const agents = useAgents();
  const createGroup = useCreateGroup();
  const [creating, setCreating] = useState(false);
  const [launching, setLaunching] = useState<Scenario[] | undefined>(undefined);

  const agentList = agents.data ?? [];
  const noAgents = agents.isSuccess && agentList.length === 0;

  const newGroup = (
    <Button icon={<PlusIcon size={16} />} onClick={() => setCreating(true)}>
      {t("groups.new")}
    </Button>
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
        action={newGroup}
      />
    );
  } else {
    body = (
      <GroupTable
        groups={groups.data}
        // The scenarios the group holds now, newest first like the API lists them.
        onLaunch={(group) => setLaunching((scenarios.data ?? []).filter((scenario) => scenario.groupId === group.id))}
      />
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
            {newGroup}
          </>
        }
      />
      {noAgents ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <p>{t("scenarios.noAgentHint")}</p>
          <Link href="/agents" className={cn("rounded", focusRing)}>
            {t("scenarios.addAgent")}
          </Link>
        </div>
      ) : null}
      {body}

      <Dialog
        open={creating}
        title={t("groups.new")}
        description={t("groups.newDescription")}
        onClose={() => setCreating(false)}
      >
        {creating ? (
          <GroupForm
            id={NEW_GROUP_FORM}
            onSubmit={async (group) => {
              const created = await createGroup.mutateAsync(group);
              setCreating(false);
              router.push(groupHref(created));
            }}
            actions={
              <>
                <Button variant="ghost" onClick={() => setCreating(false)}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" form={NEW_GROUP_FORM} loading={createGroup.isPending}>
                  {t("groups.create")}
                </Button>
              </>
            }
          />
        ) : null}
      </Dialog>
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
