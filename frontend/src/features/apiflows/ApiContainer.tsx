"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EditableTitle } from "@/features/scenarios/EditableTitle";
import { GroupMeta } from "@/features/scenarios/GroupMeta";
import { PageHeader } from "@/features/shell/PageHeader";
import { ApiError, errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, ApiFlowsIcon, Button, Dialog, EmptyState, PencilIcon, PlusIcon, Spinner, buttonClasses } from "@/ui";
import { ApiConnection } from "./ApiConnection";
import { newFlowHref } from "./ApiTable";
import { EditConnectionDialog } from "./EditConnectionDialog";
import { FlowLibraryRail } from "./FlowLibraryRail";
import { useApi, useApiFlows, useDeleteApi } from "./queries";
import type { Api } from "./types";
import { useApiEdits } from "./use-api-edits";

/**
 * `/apis/[id]`: the API's name, description, connection and tags (each edited in place) over its
 * flows in the sidebar; until one is picked, a placeholder.
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
  const flows = useApiFlows(api.id);
  const remove = useDeleteApi();
  const edits = useApiEdits(api.id);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);

  async function confirmDelete() {
    try {
      await remove.mutateAsync(api);
    } catch {
      return; // shown in the dialog
    }
    setDeleting(false);
    router.push("/apis");
  }

  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        breadcrumbs={[{ label: t("nav.apis"), href: "/apis" }]}
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
        <FlowLibraryRail api={api} flows={flows.data} failed={flows.isError && flows.data === undefined} />
        <EmptyState
          icon={<ApiFlowsIcon size={22} />}
          title={t("apis.pickTitle")}
          description={flows.data && flows.data.length === 0 ? t("apis.pickEmpty") : t("apis.pickHint")}
          action={
            <Link href={newFlowHref(api)} className={buttonClasses(flows.data && flows.data.length > 0 ? "secondary" : "primary")}>
              <PlusIcon size={16} />
              {t("apis.newFlow")}
            </Link>
          }
        />
      </div>

      {editing ? <EditConnectionDialog api={api} onClose={() => setEditing(false)} /> : null}
      <Dialog
        open={deleting}
        title={t("common.deleteTitle", { name: api.name })}
        description={t("apis.deleteDescription")}
        onClose={() => setDeleting(false)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => void confirmDelete()}>
              {t("apis.delete")}
            </Button>
          </>
        }
      >
        {remove.isError ? <Alert>{errorMessage(remove.error)}</Alert> : null}
      </Dialog>
    </div>
  );
}
