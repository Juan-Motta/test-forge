"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PageHeader } from "@/features/shell/PageHeader";
import { errorMessage } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { confirmLeave, useUnsavedChangesGuard } from "@/lib/navigation/unsaved-changes";
import { Alert, ApiFlowsIcon, Button, EmptyState, PlusIcon, Spinner } from "@/ui";
import { ApiForm } from "./ApiForm";
import { ApisRail } from "./ApisRail";
import { DeleteApiDialog } from "./DeleteApiDialog";
import { NewApiForm } from "./NewApiForm";
import { useApis } from "./queries";
import type { Api } from "./types";
import { useApiSave, type ApiSaveOutcome } from "./use-api-save";

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
 * Container for `/apis`: master/detail, like `/agents`. The rail lists the APIs; the detail edits
 * the open one's connection in cards (name, description, tags, base URL, secrets, headers), saved
 * from the header. New APIs are created in a form beside the rail. Flows live on API → Flows.
 */
export function ApisContainer() {
  const t = useT();
  const apis = useApis();
  const formId = useId();
  const [requestedId, setRequestedId] = useState<string | null>(apiFromAddress);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Persistent polite live region: announces saves that otherwise only change the form.
  const [notice, setNotice] = useState("");
  // The open API's form holds unsaved edits: switching APIs (or leaving the page) asks first.
  const [dirty, setDirty] = useState(false);
  const deleteNext = useRef<string | null>(null);
  useUnsavedChangesGuard(dirty, t("common.leaveUnsaved"));
  // Bumped per API after a successful save: the form remounts on what is stored now. A
  // background refetch alone never remounts it, so it never discards edits.
  const [formVersions, setFormVersions] = useState<Record<string, number>>({});
  // A client-side navigation (the API page's breadcrumb) can render this before the address
  // changes; read it again once mounted, and on back/forward.
  useEffect(() => {
    const sync = () => setRequestedId(apiFromAddress());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const list = apis.data ?? [];
  const selected = list.find((api) => api.id === requestedId) ?? list[0];
  const save = useApiSave(selected, onSaved);

  function select(id: string | null) {
    setRequestedId(id);
    writeApiToAddress(id);
  }

  /** Opens another API from the rail, once any unsaved edits may be discarded. */
  function open(id: string) {
    if (id === selected?.id) return;
    if (!confirmLeave()) return;
    save.reset();
    select(id);
  }

  function onSaved(api: Api, outcome: ApiSaveOutcome) {
    setNotice(outcome === "saved" ? t("common.savedNamed", { name: api.name }) : t("common.noChanges"));
    if (outcome === "saved") setFormVersions((current) => ({ ...current, [api.id]: (current[api.id] ?? 0) + 1 }));
  }

  /** After a delete, open the API that took its place in the rail (the next one, else the previous). */
  function onDeleted(api: Api) {
    setDeleting(false);
    setNotice(t("common.deleted", { name: api.name }));
    select(deleteNext.current);
  }

  const openCreate = () => {
    if (!confirmLeave()) return;
    save.reset();
    setCreating(true);
  };
  const addButton = (
    <Button key="add" variant="secondary" icon={<PlusIcon size={16} />} onClick={openCreate}>
      {t("apis.add")}
    </Button>
  );

  const status = (
    <p role="status" className="sr-only">
      {notice}
    </p>
  );

  if (creating) {
    return (
      <>
        <PageHeader title={t("apis.connectionsTitle")} description={t("apis.description")} />
        {status}
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          {list.length > 0 ? (
            <ApisRail
              apis={list}
              selectedId={null}
              onSelect={(api) => {
                if (!confirmLeave()) return;
                setCreating(false);
                select(api.id);
              }}
              onNew={() => setCreating(true)}
            />
          ) : null}
          <NewApiForm
            onDirtyChange={setDirty}
            onClose={() => setCreating(false)}
            onCreated={(api) => {
              setCreating(false);
              setNotice(t("common.created", { name: api.name }));
              select(api.id);
            }}
          />
        </div>
      </>
    );
  }

  let header;
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
  } else {
    header = (
      <PageHeader
        title={selected.name}
        description={t("apis.description")}
        actions={[
          addButton,
          selected.flowCount === 0 ? (
            <Button
              key="delete"
              variant="ghost"
              aria-label={t("apis.deleteNamed", { name: selected.name })}
              onClick={() => {
                // The neighbour is chosen now: once deleted, the refetched list no longer holds it.
                const index = list.findIndex((item) => item.id === selected.id);
                const rest = list.filter((item) => item.id !== selected.id);
                deleteNext.current = rest[Math.min(Math.max(index, 0), rest.length - 1)]?.id ?? null;
                setDeleting(true);
              }}
            >
              {t("common.delete")}
            </Button>
          ) : null,
          <Button key="save" type="submit" form={formId} loading={save.pending}>
            {save.pending ? t("editor.saving") : t("apis.saveChanges")}
          </Button>,
        ]}
      />
    );
    body = (
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <ApisRail apis={list} selectedId={selected.id} onSelect={(api) => open(api.id)} onNew={openCreate} />
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <ApiForm
            // A fresh form per API and after each of its saves: half-typed edits and revealed
            // secrets never carry over; a background refetch alone never remounts it.
            key={`${selected.id}:${formVersions[selected.id] ?? 0}`}
            api={selected}
            formId={formId}
            onSubmit={save.onSubmit}
            error={save.error}
            serverFieldErrors={save.fieldErrors}
            onDirtyChange={setDirty}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      {header ?? <PageHeader title={t("apis.connectionsTitle")} description={t("apis.description")} actions={addButton} />}
      {status}
      {body}
      <DeleteApiDialog api={deleting ? selected : undefined} onClose={() => setDeleting(false)} onDeleted={onDeleted} />
    </>
  );
}
