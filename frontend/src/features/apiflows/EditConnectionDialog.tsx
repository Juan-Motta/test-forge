"use client";

import { useState, type FormEvent } from "react";
import { formErrorView } from "@/lib/api";
import { localizeFormError, useT } from "@/lib/i18n";
import { Alert, Button, Dialog, Field, Input } from "@/ui";
import {
  connectionChanges,
  connectionProblems,
  connectionRows,
  fieldError,
  newVariable,
  rowKeys,
  variableErrors,
  type HeaderRow,
  type VariableRow,
} from "./connection-form";
import { ConnectionVariables } from "./ConnectionVariables";
import { HeaderRows } from "./HeaderRows";
import { useUpdateApi } from "./queries";
import type { Api } from "./types";
import { useSecretReveal } from "./use-secret-reveal";

const FORM_ID = "edit-connection-form";

/**
 * "Edit connection": the base URL, the variables (each plain or secret) and the default headers.
 * Stored secrets show masked, with an eye; their values come back only when it is clicked, and
 * only the variables typed, switched or removed are sent. Mounted only while open, so a revealed
 * value never outlives it.
 */
export function EditConnectionDialog({ api, onClose }: { api: Api; onClose: () => void }) {
  const t = useT();
  const update = useUpdateApi();
  const [nextKey] = useState(() => rowKeys("row"));
  const [baseUrl, setBaseUrl] = useState(api.baseUrl);
  const reveal = useSecretReveal(api.id);
  const [initial] = useState(() => connectionRows(api, nextKey));
  const [headers, setHeaders] = useState<HeaderRow[]>(initial.headers);
  const [variables, setVariables] = useState<VariableRow[]>(initial.variables);
  const [local, setLocal] = useState<Record<string, string>>({});

  const view = update.isError ? localizeFormError(t, update.error, formErrorView(update.error, t("apis.error.taken"))) : undefined;
  const errors = { ...view?.fieldErrors, ...local };
  const variableErrorsView = variableErrors(view?.fieldErrors ?? {}, variables);
  const hints = Object.fromEntries(api.secrets.map((secret) => [secret.name, secret.hint]));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!baseUrl.trim()) problems.baseUrl = t("apis.error.baseUrl");
    const rows = connectionProblems({ headers, variables });
    if (rows.variables) problems.variables = t(`apis.error.rows.${rows.variables}`);
    if (rows.headers) problems.headers = t(`apis.error.rows.${rows.headers}`);
    setLocal(problems);
    if (Object.keys(problems).length > 0) return;
    const changes = connectionChanges(api, { baseUrl, headers, variables });
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
        <ConnectionVariables
          rows={variables}
          onChange={setVariables}
          onAdd={() => setVariables((rows) => [...rows, newVariable(nextKey())])}
          error={local.variables ?? variableErrorsView.section}
          rowErrors={variableErrorsView.byName}
          hint={t("apis.variablesHint")}
          hints={hints}
          reveal={reveal}
        />
        {reveal.error ? (
          <p role="alert" className="text-xs text-danger-fg">
            {t("apis.revealFailed", { error: reveal.error })}
          </p>
        ) : null}
        <HeaderRows
          rows={headers}
          onChange={setHeaders}
          onAdd={() => setHeaders((rows) => [...rows, { key: nextKey(), name: "", value: "" }])}
          error={fieldError(errors, "headers")}
          hint={t("apis.headersHint")}
        />
      </form>
    </Dialog>
  );
}
