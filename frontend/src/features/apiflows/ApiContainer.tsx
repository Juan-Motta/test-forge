"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { EditableTitle } from "@/features/scenarios/EditableTitle";
import { GroupMeta } from "@/features/scenarios/GroupMeta";
import { PageHeader } from "@/features/shell/PageHeader";
import { ApiError, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, ApiFlowsIcon, Button, EmptyState, PencilIcon, PlayIcon, PlusIcon, Spinner, buttonClasses } from "@/ui";
import { ApiConnection } from "./ApiConnection";
import { DeleteApiDialog } from "./DeleteApiDialog";
import { EditConnectionDialog } from "./EditConnectionDialog";
import { FlowEditorContainer } from "./FlowEditorContainer";
import { FlowLibraryRail } from "./FlowLibraryRail";
import { apiConnectionHref, newFlowHref } from "./links";
import { useApi, useApiFlows } from "./queries";
import { RunAllDialog } from "./RunAllDialog";
import { RunFormContainer } from "./RunForm";
import { RunViewContainer } from "./RunViewContainer";
import type { Api, Flow } from "./types";
import { useApiEdits } from "./use-api-edits";

/**
 * `/apis/[id]`: the API's name, description, connection and tags (each edited in place) over its
 * flows in the sidebar; beside them the flow editor (`?flow=<id>`, or `?new=flow`), a flow's run
 * form (`&run=new`) or one of its runs (`&run=<runId>`), or until one is picked, a placeholder.
 */
export function ApiContainer({ apiId }: { apiId: string }) {
  const t = useT();
  const api = useApi(apiId);

  if (api.isError && api.error instanceof ApiError && api.error.status === 404) {
    return (
      <EmptyState
        icon={<ApiFlowsIcon size={22} />}
        title={t("apis.notFound")}
        description={t("apis.notFoundHint")}
        action={
          <Link href="/apis" className={buttonClasses("secondary")}>
            {t("apis.back")}
          </Link>
        }
      />
    );
  }
  if (api.isError) {
    return (
      <Alert title={t("apis.loadOneFailed")}>
        <span className="block">{errorMessage(api.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => api.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  }
  if (api.isPending) return <Spinner label={t("apis.loadingOne")} />;
  return <ApiPage api={api.data} />;
}

function ApiPage({ api }: { api: Api }) {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const flowId = params.get("flow") ?? undefined;
  const creating = params.get("new") === "flow";
  const runId = params.get("run") ?? undefined;
  const flows = useApiFlows(api.id);
  const edits = useApiEdits(api.id);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [runningAll, setRunningAll] = useState(false);

  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        breadcrumbs={[{ label: t("nav.apis"), href: apiConnectionHref(api) }]}
        title={
          <EditableTitle
            value={api.name}
            placeholder={t("apis.untitled")}
            label={t("apis.rename", { name: api.name })}
            onCommit={edits.rename}
          />
        }
        description={
          <div className="flex flex-col gap-2.5">
            <GroupMeta
              description={api.description}
              tags={api.tags}
              onDescription={edits.describe}
              onTags={edits.retag}
              descriptionPlaceholder={t("apis.descriptionPlaceholder")}
              tagsLabel={t("apis.tagsLabel")}
            />
            {/* A save hides any revealed value again (the secrets may have changed). */}
            <ApiConnection key={api.updatedAt} api={api} />
          </div>
        }
        actions={
          <>
            {api.flowCount > 0 ? (
              <Button variant="secondary" icon={<PlayIcon size={14} />} onClick={() => setRunningAll(true)}>
                {t("runAll.button")}
              </Button>
            ) : null}
            <Button variant="secondary" icon={<PencilIcon size={14} />} onClick={() => setEditing(true)}>
              {t("apis.editConnection")}
            </Button>
            {api.flowCount === 0 ? (
              <Button variant="ghost" aria-label={t("apis.deleteNamed", { name: api.name })} onClick={() => setDeleting(true)}>
                {t("common.delete")}
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid items-start gap-5 min-[1340px]:grid-cols-[240px_minmax(0,1fr)]">
        <FlowLibraryRail
          api={api}
          flows={flows.data}
          failed={flows.isError && flows.data === undefined}
          selectedId={creating ? undefined : flowId}
        />
        <FlowPane api={api} flows={flows.data} failed={flows.isError && flows.data === undefined} flowId={flowId} runId={runId} creating={creating} />
      </div>

      {editing ? <EditConnectionDialog api={api} onClose={() => setEditing(false)} /> : null}
      {runningAll ? <RunAllDialog api={api} onClose={() => setRunningAll(false)} /> : null}
      <DeleteApiDialog
        api={deleting ? api : undefined}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          setDeleting(false);
          router.push("/apis");
        }}
      />
    </div>
  );
}

type FlowPaneProps = { api: Api; flows: Flow[] | undefined; failed: boolean; flowId?: string; runId?: string; creating: boolean };

/** The main area: a new flow, the selected flow, its run form or one of its runs, or a placeholder until one is picked. */
function FlowPane({ api, flows, failed, flowId, runId, creating }: FlowPaneProps) {
  const t = useT();
  if (creating) return <FlowEditorContainer key="new" api={api} />;
  if (flowId !== undefined) {
    const flow = flows?.find((item) => item.id === flowId);
    if (flow && runId === "new") return <RunFormContainer key={`${flow.id}-run`} api={api} flow={flow} />;
    if (flow && runId !== undefined) return <RunViewContainer key={runId} api={api} flow={flow} runId={runId} />;
    if (flow) return <FlowEditorContainer key={flow.id} api={api} flow={flow} />;
    if (flows === undefined && !failed) return <Spinner label={t("flows.loading")} />;
    if (flows !== undefined) {
      return <EmptyState icon={<ApiFlowsIcon size={22} />} title={t("flows.notFound")} description={t("flows.notFoundHint")} />;
    }
  }
  return (
    <EmptyState
      icon={<ApiFlowsIcon size={22} />}
      title={t("apis.pickTitle")}
      description={flows && flows.length === 0 ? t("apis.pickEmpty") : t("apis.pickHint")}
      action={
        <Link href={newFlowHref(api)} className={buttonClasses(flows && flows.length > 0 ? "secondary" : "primary")}>
          <PlusIcon size={16} />
          {t("apis.newFlow")}
        </Link>
      }
    />
  );
}
