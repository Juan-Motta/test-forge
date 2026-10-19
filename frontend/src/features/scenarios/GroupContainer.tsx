"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { LaunchRunsDialog } from "@/features/runs/LaunchRunsDialog";
import { PageHeader } from "@/features/shell/PageHeader";
import { ApiError, errorMessage } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { Alert, Button, Dialog, EmptyState, PlayIcon, ScenariosIcon, Spinner, buttonClasses } from "@/ui";
import { GroupForm } from "./GroupForm";
import { useDeleteGroup, useGroup, useScenarios, useUpdateGroup } from "./queries";
import { ScenarioLibraryRail } from "./ScenarioLibraryRail";
import type { Scenario } from "./types";

const DETAILS_FORM = "group-details-form";

/**
 * `/scenarios/groups/[id]`: the group's scenarios in the sidebar (each opens the editor, which
 * keeps the same sidebar) beside the group's details: title, description and tags.
 */
export function GroupContainer({ groupId }: { groupId: string }) {
  const t = useT();
  const router = useRouter();
  const { relativeTime } = useFormat();
  const group = useGroup(groupId);
  const scenarios = useScenarios();
  const agents = useAgents();
  const update = useUpdateGroup();
  const remove = useDeleteGroup();
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [launching, setLaunching] = useState<Scenario[] | undefined>(undefined);

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

  const current = group.data;
  const members = scenarios.data?.filter((scenario) => scenario.groupId === current.id);
  const agentList = agents.data ?? [];

  async function confirmDelete() {
    try {
      await remove.mutateAsync(current);
    } catch {
      return; // shown in the dialog
    }
    setDeleting(false);
    router.push("/scenarios");
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        title={current.name}
        breadcrumbs={[{ label: t("nav.scenarios"), href: "/scenarios" }]}
        actions={
          members && members.length > 0 ? (
            <Button
              icon={<PlayIcon size={14} />}
              aria-label={t("groups.launch", { name: current.name })}
              onClick={() => setLaunching(members)}
            >
              {t("groups.launchShort")}
            </Button>
          ) : null
        }
      />
      <div className="grid items-start gap-5 min-[1340px]:grid-cols-[240px_minmax(0,1fr)]">
        <ScenarioLibraryRail
          scenarios={members}
          failed={scenarios.isError && scenarios.data === undefined}
          group={current}
          groupCurrent
        />
        <section
          aria-labelledby="group-details-heading"
          className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-panel p-5"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="group-details-heading" className="text-[15px] font-semibold">
              {t("groups.details")}
            </h2>
            <p className="flex flex-wrap gap-1.5 text-xs text-muted">
              <span>{t.plural("agents.scenarioCount", current.scenarioCount)}</span>
              {current.latestScenarioAt ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{t("groups.latestChange", { time: relativeTime(current.latestScenarioAt) })}</span>
                </>
              ) : null}
            </p>
          </div>
          <GroupForm
            key={current.updatedAt}
            id={DETAILS_FORM}
            initial={current}
            onSubmit={async (changes) => {
              setSaved(false);
              await update.mutateAsync({ id: current.id, changes });
              setSaved(true);
            }}
            actions={
              <>
                <p role="status" className="mr-auto self-center text-xs text-dim">
                  {saved ? t("editor.saved") : ""}
                </p>
                {current.scenarioCount === 0 ? (
                  <Button variant="ghost" aria-label={t("groups.deleteNamed", { name: current.name })} onClick={() => setDeleting(true)}>
                    {t("common.delete")}
                  </Button>
                ) : null}
                <Button type="submit" form={DETAILS_FORM} loading={update.isPending}>
                  {t("groups.save")}
                </Button>
              </>
            }
          />
          {current.scenarioCount > 0 ? (
            <p className="text-xs text-muted">{t.plural("groups.deleteBlocked", current.scenarioCount)}</p>
          ) : null}
        </section>
      </div>

      <Dialog
        open={deleting}
        title={t("common.deleteTitle", { name: current.name })}
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
