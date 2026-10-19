"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { LaunchRunsDialog } from "@/features/runs/LaunchRunsDialog";
import { PageHeader } from "@/features/shell/PageHeader";
import { ApiError, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, Button, Dialog, EmptyState, PlayIcon, PlusIcon, ScenariosIcon, Spinner, buttonClasses } from "@/ui";
import { EditableTitle } from "./EditableTitle";
import { GroupMeta } from "./GroupMeta";
import { useDeleteGroup, useGroup, useScenarios } from "./queries";
import { ScenarioLibraryRail } from "./ScenarioLibraryRail";
import type { Scenario, ScenarioGroup } from "./types";
import { useGroupEdits } from "./use-group-edits";

/**
 * `/scenarios/groups/[id]`: the group's title, description and tags (each edited in place) over
 * its scenarios in the sidebar; until one is picked, a placeholder offers to run them all.
 */
export function GroupContainer({ groupId }: { groupId: string }) {
  const t = useT();
  const group = useGroup(groupId);

  if (group.isError && group.error instanceof ApiError && group.error.status === 404) {
    return (
      <EmptyState
        icon={<ScenariosIcon size={22} />}
        title={t("groups.notFound")}
        description={t("groups.notFoundHint")}
        action={
          <Link href="/scenarios" className={buttonClasses("secondary")}>
            {t("groups.back")}
          </Link>
        }
      />
    );
  }
  if (group.isError) {
    return (
      <Alert title={t("groups.loadOneFailed")}>
        <span className="block">{errorMessage(group.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => group.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  }
  if (group.isPending) return <Spinner label={t("groups.loadingOne")} />;
  return <GroupPage group={group.data} />;
}

function GroupPage({ group }: { group: ScenarioGroup }) {
  const t = useT();
  const router = useRouter();
  const scenarios = useScenarios();
  const agents = useAgents();
  const remove = useDeleteGroup();
  const edits = useGroupEdits(group.id);
  const [deleting, setDeleting] = useState(false);
  const [launching, setLaunching] = useState<Scenario[] | undefined>(undefined);

  const members = scenarios.data?.filter((scenario) => scenario.groupId === group.id);
  const agentList = agents.data ?? [];
  const newScenarioHref = `/scenarios/new?group=${encodeURIComponent(group.id)}`;

  async function confirmDelete() {
    try {
      await remove.mutateAsync(group);
    } catch {
      return; // shown in the dialog
    }
    setDeleting(false);
    router.push("/scenarios");
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        breadcrumbs={[{ label: t("nav.scenarios"), href: "/scenarios" }]}
        title={
          <EditableTitle
            value={group.name}
            placeholder={t("groups.untitled")}
            label={t("groups.rename", { name: group.name })}
            onCommit={edits.rename}
          />
        }
        description={
          <GroupMeta description={group.description} tags={group.tags} onDescription={edits.describe} onTags={edits.retag} />
        }
        actions={
          group.scenarioCount === 0 ? (
            <Button variant="ghost" aria-label={t("groups.deleteNamed", { name: group.name })} onClick={() => setDeleting(true)}>
              {t("common.delete")}
            </Button>
          ) : null
        }
      />
      <div className="grid items-start gap-5 min-[1340px]:grid-cols-[240px_minmax(0,1fr)]">
        <ScenarioLibraryRail
          scenarios={members}
          failed={scenarios.isError && scenarios.data === undefined}
          group={group}
        />
        {/* Like Live's empty state: pick a scenario from the sidebar, or run the whole group. */}
        <EmptyState
          icon={<ScenariosIcon size={22} />}
          title={t("groups.pickTitle")}
          description={members && members.length === 0 ? t("groups.pickEmpty") : t("groups.pickHint")}
          action={
            <div className="flex flex-wrap justify-center gap-3">
              {members && members.length > 0 ? (
                <Button
                  icon={<PlayIcon size={14} />}
                  aria-label={t("groups.launch", { name: group.name })}
                  onClick={() => setLaunching(members)}
                >
                  {t("groups.runAll", { count: members.length })}
                </Button>
              ) : null}
              <Link href={newScenarioHref} className={buttonClasses(members && members.length > 0 ? "secondary" : "primary")}>
                <PlusIcon size={16} />
                {t("scenarios.new")}
              </Link>
            </div>
          }
        />
      </div>

      <Dialog
        open={deleting}
        title={t("common.deleteTitle", { name: group.name })}
        description={t("groups.deleteDescription")}
        onClose={() => setDeleting(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => void confirmDelete()}>
              {t("groups.delete")}
            </Button>
          </>
        }
      >
        {remove.isError ? <Alert>{errorMessage(remove.error)}</Alert> : null}
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
    </div>
  );
}
