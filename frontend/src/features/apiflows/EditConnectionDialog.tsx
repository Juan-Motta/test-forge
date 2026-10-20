"use client";

import { useState, type FormEvent } from "react";
import { formErrorView } from "@/lib/api";
import { localizeFormError, useT } from "@/lib/i18n";
import { Alert, Button, Dialog, Field, Input } from "@/ui";
import { MAX_SECRETS, connectionChanges, fieldError, rowKeys, rowsProblem, type PairRow } from "./connection-form";
import { PairRows } from "./PairRows";
import { useUpdateApi } from "./queries";
import type { Api } from "./types";

const FORM_ID = "edit-connection-form";

/**
 * "Edit connection": the base URL, plain headers and secrets. Stored secrets start empty (their
 * values never come back here); only the ones typed or removed are sent. Mounted only while open.
 */
export function EditConnectionDialog({ api, onClose }: { api: Api; onClose: () => void }) {
  const t = useT();
  const update = useUpdateApi();
  const [nextKey] = useState(() => rowKeys("row"));
  const [baseUrl, setBaseUrl] = useState(api.baseUrl);
  const [headers, setHeaders] = useState<PairRow[]>(() => api.headers.map((header) => ({ key: nextKey(), ...header })));
  const [secrets, setSecrets] = useState<PairRow[]>(() =>
    api.secrets.map((secret) => ({ key: nextKey(), name: secret.name, value: "", locked: true })),
  );
  const [local, setLocal] = useState<Record<string, string>>({});

  const view = update.isError ? localizeFormError(t, update.error, formErrorView(update.error, t("apis.error.taken"))) : undefined;
  const errors = { ...view?.fieldErrors, ...local };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!baseUrl.trim()) problems.baseUrl = t("apis.error.baseUrl");
    const secretProblem = rowsProblem(secrets, "secret");
    if (secretProblem) problems.secrets = t(`apis.error.rows.${secretProblem}`);
    const headerProblem = rowsProblem(headers, "header");
    if (headerProblem) problems.headers = t(`apis.error.rows.${headerProblem}`);
    setLocal(problems);
    if (Object.keys(problems).length > 0) return;
    const changes = connectionChanges(api, { baseUrl, headers, secrets });
    if (Object.keys(changes).length === 0) return onClose();
    update.reset();
    try {
      await update.mutateAsync({ id: api.id, changes });
      onClose();
    } catch {
      // shown in the form
    }
  }

  return (
    <Dialog
      open
      size="lg"
      title={t("apis.editConnection")}
      description={t("apis.editConnectionDescription")}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={FORM_ID} loading={update.isPending}>
            {t("apis.saveConnection")}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {view?.message ? <Alert>{view.message}</Alert> : null}
        <Field label={t("apis.field.baseUrl")} hint={t("apis.baseUrlHint")} error={errors.baseUrl}>
          {(props) => (
            <Input {...props} mono type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          )}
        </Field>
        <PairRows
          kind="secret"
          rows={secrets}
          onChange={setSecrets}
          onAdd={() => setSecrets((rows) => [...rows, { key: nextKey(), name: "", value: "" }])}
          error={fieldError(errors, "secrets")}
          max={MAX_SECRETS}
        />
        <PairRows
          kind="header"
          rows={headers}
          onChange={setHeaders}
          onAdd={() => setHeaders((rows) => [...rows, { key: nextKey(), name: "", value: "" }])}
          error={fieldError(errors, "headers")}
        />
      </form>
    </Dialog>
  );
}
