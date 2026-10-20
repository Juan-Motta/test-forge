"use client";

import { useState } from "react";
import { EditableTitle } from "@/features/scenarios/EditableTitle";
import { GroupMeta } from "@/features/scenarios/GroupMeta";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, ApiFlowsIcon, Button, EmptyState, PencilIcon, PlusIcon, Spinner } from "@/ui";
import { ApiConnection } from "./ApiConnection";
import { ApiFlowsCard } from "./ApiFlowsCard";
import { ApisRail } from "./ApisRail";
import { DeleteApiDialog } from "./DeleteApiDialog";
import { EditConnectionDialog } from "./EditConnectionDialog";
import { NewApiDialog } from "./NewApiDialog";
import { useApis } from "./queries";
import type { Api } from "./types";
import { useApiEdits } from "./use-api-edits";

/** The address names the open API (`/apis?api=<id>`), so a detail can be linked and reloaded. */
const API_PARAM = "api";

function apiFromAddress(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(API_PARAM);
}

/** The native History API keeps Next's router in sync without a navigation. */
function writeApiToAddress(id: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (id === null) params.delete(API_PARAM);
  else params.set(API_PARAM, id);
  const query = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
}

/**
 * Container for `/apis`: master/detail, like `/agents`. The header shows the open API's name,
 * description, tags and connection (each edited in place); the rail lists the APIs beside its flows.
 * New APIs are created in a dialog. The flow workspace stays at `/apis/[id]`.
 */
export function ApisContainer() {
  const t = useT();
  const apis = useApis();
  const [requestedId, setRequestedId] = useState<string | null>(apiFromAddress);
  const [creating, setCreating] = useState(false);

  const list = apis.data ?? [];
  const selected = list.find((api) => api.id === requestedId) ?? list[0];

  function select(id: string | null) {
    setRequestedId(id);
    writeApiToAddress(id);
  }

  /** After a delete, open the API that took its place in the rail (the next one, else the previous). */
  function onDeleted(api: Api) {
    const index = list.findIndex((item) => item.id === api.id);
    const rest = list.filter((item) => item.id !== api.id);
    select(rest[Math.min(Math.max(index, 0), rest.length - 1)]?.id ?? null);
  }

  const openCreate = () => setCreating(true);

  let body;
  if (apis.isPending) {
    body = <Spinner label={t("apis.loading")} />;
  } else if (apis.isError) {
    body = (
      <Alert title={t("apis.loadFailed")}>
        <span className="block">{errorMessage(apis.error)}</span>
        <Button variant="secondary" className="mt-3" onClick={() => apis.refetch()}>
          {t("common.tryAgain")}
        </Button>
      </Alert>
    );
  } else if (!selected) {
    body = (
      <EmptyState
        icon={<ApiFlowsIcon size={22} />}
        title={t("apis.emptyTitle")}
        description={t("apis.emptyDescription")}
        action={
          <Button icon={<PlusIcon size={16} />} onClick={openCreate}>
            {t("apis.new")}
          </Button>
        }
      />
    );
  }

  return (
    <>
      {selected && !body ? (
        <>
          {/* A fresh header per API: half-typed edits and revealed secrets never carry over. */}
          <ApiHeader key={selected.id} api={selected} onDeleted={onDeleted} />
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <ApisRail apis={list} selectedId={selected.id} onSelect={(api) => select(api.id)} onNew={openCreate} />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <ApiFlowsCard key={selected.id} api={selected} />
            </div>
          </div>
        </>
      ) : (
        <>
          <PageHeader title={t("nav.apis")} description={t("apis.description")} />
          {body}
        </>
      )}
      {creating ? (
        <NewApiDialog
          onClose={() => setCreating(false)}
          onCreated={(api) => {
            setCreating(false);
            select(api.id);
          }}
        />
      ) : null}
    </>
  );
}

/** The open API's header: its name, description, tags and connection, each edited in place; edit and delete. */
function ApiHeader({ api, onDeleted }: { api: Api; onDeleted: (api: Api) => void }) {
  const t = useT();
  const edits = useApiEdits(api.id);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <>
      <PageHeader
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

      {editing ? <EditConnectionDialog api={api} onClose={() => setEditing(false)} /> : null}
      <DeleteApiDialog
        api={deleting ? api : undefined}
        onClose={() => setDeleting(false)}
        onDeleted={(gone) => {
          setDeleting(false);
          onDeleted(gone);
        }}
      />
    </>
  );
}
