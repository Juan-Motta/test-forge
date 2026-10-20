"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAgents } from "@/features/agents/queries";
import { ApiError } from "@/lib/api";
import { localErrorMessage, useT } from "@/lib/i18n";
import { Alert, Button, Dialog, useClipboard } from "@/ui";
import { flowCurls } from "./api";
import { apiHref, flowHref, runHref } from "./ApiTable";
import { draftOf, payloadOf, type FlowDraft } from "./flow-draft";
import { flowErrors, isPlaced } from "./flow-errors";
import { FlowEditor } from "./FlowEditor";
import { useCreateFlow, useDeleteFlow, useUpdateFlow } from "./queries";
import { RecentRuns } from "./RecentRuns";
import type { Api, Flow } from "./types";

/** Every row's key in order: it changes when a row is added, moved or removed. */
const keysOf = (draft: FlowDraft) =>
  [
    ...draft.inputs.map((input) => input.key),
    ...draft.steps.flatMap((step) => [step.key, ...[...step.query, ...step.headers, ...step.saves, ...step.checks].map((row) => row.key)]),
  ].join(" ");

/**
 * The flow editor's state: a working copy saved whole (POST for a new flow, PATCH for a stored
 * one), backend errors mapped to their rows, Copy cURL of the saved flow, and delete.
 */
export function FlowEditorContainer({ api, flow }: { api: Pick<Api, "id">; flow?: Flow }) {
  const t = useT();
  const router = useRouter();
  const agents = useAgents();
  const create = useCreateFlow();
  const update = useUpdateFlow();
  const remove = useDeleteFlow();
  const [draft, setDraft] = useState(() => draftOf(flow));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [alert, setAlert] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [deleting, setDeleting] = useState(false);
  const [clip, copy] = useClipboard();
  const [copied, setCopied] = useState<number>();

  function change(next: FlowDraft) {
    // Row errors point at positions: once rows are added, moved or removed they no longer fit.
    if (keysOf(next) !== keysOf(draft)) {
      setErrors({});
      setFormErrors([]);
    }
    setStatus(undefined);
    setDraft(next);
  }

  function failed(error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      setErrors({ name: error.message });
    } else if (error instanceof ApiError && error.status === 422 && Object.keys(error.fieldErrors).length > 0) {
      const all = Object.entries(flowErrors(error.fieldErrors));
      setErrors(Object.fromEntries(all.filter(([key]) => isPlaced(key))));
      setFormErrors(all.filter(([key]) => !isPlaced(key)).map(([key, msg]) => `${key}: ${msg}`));
      setAlert(t("common.checkFields"));
    } else {
      setAlert(localErrorMessage(t, error));
    }
  }

  async function save() {
    const { payload, invalidBodies } = payloadOf(draft);
    const local: Record<string, string> = {};
    if (!payload.name) local.name = t("flows.error.name");
    for (const index of invalidBodies) local[`steps.${index}.body`] = t("flows.error.json");
    setErrors(local);
    setFormErrors([]);
    setAlert(undefined);
    setStatus(undefined);
    if (Object.keys(local).length > 0) return;
    try {
      if (flow) {
        await update.mutateAsync({ id: flow.id, changes: payload });
        setStatus(t("common.savedNamed", { name: payload.name }));
      } else {
        const created = await create.mutateAsync({ ...payload, apiId: api.id });
        router.push(flowHref(api, created.id));
      }
    } catch (error) {
      failed(error);
    }
  }

  // The cURL of what is saved (the backend renders it), masked; asked each time, never cached.
  async function copyCurl(index: number) {
    if (!flow) return;
    setAlert(undefined);
    try {
      const { steps } = await flowCurls(flow.id);
      await copy(steps[index]?.curl ?? "");
      setCopied(index);
    } catch (error) {
      setAlert(localErrorMessage(t, error));
    }
  }

  async function confirmDelete() {
    if (!flow) return;
    try {
      await remove.mutateAsync(flow);
    } catch {
      return; // shown in the dialog
    }
    setDeleting(false);
    router.push(apiHref(api));
  }

  const copyStatus =
    clip === "copied" && copied !== undefined ? t("flows.curlCopied", { n: copied + 1 }) : clip === "failed" ? t("ui.copyFailed") : undefined;

  return (
    <>
      <FlowEditor
        draft={draft}
        onChange={change}
        errors={errors}
        formErrors={formErrors}
        alert={alert}
        status={status ?? copyStatus}
        saving={create.isPending || update.isPending}
        onSave={() => void save()}
        runHref={flow ? runHref(api, flow.id, "new") : undefined}
        onDelete={flow ? () => setDeleting(true) : undefined}
        onCopyCurl={flow ? (index) => void copyCurl(index) : undefined}
        agents={agents.data}
        agentsFailed={agents.isError && agents.data === undefined}
        knownAgents={flow?.agents ?? []}
        recentRuns={flow ? <RecentRuns api={api} flowId={flow.id} /> : undefined}
      />
      {flow ? (
        <Dialog
          open={deleting}
          title={t("common.deleteTitle", { name: flow.name })}
          description={t("flows.deleteDescription")}
          onClose={() => setDeleting(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                {t("common.cancel")}
              </Button>
              <Button variant="danger" loading={remove.isPending} onClick={() => void confirmDelete()}>
                {t("flows.delete")}
              </Button>
            </>
          }
        >
          {remove.isError ? <Alert>{localErrorMessage(t, remove.error)}</Alert> : null}
        </Dialog>
      ) : null}
    </>
  );
}
