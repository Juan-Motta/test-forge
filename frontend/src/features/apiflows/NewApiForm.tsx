"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { formErrorView } from "@/lib/api";
import { confirmLeave } from "@/lib/navigation/unsaved-changes";
import { localizeFormError, useT } from "@/lib/i18n";
import { Alert, Button, Card, Field, Input, Textarea } from "@/ui";
import {
  connectionProblems,
  fieldError,
  newConnection,
  newVariable,
  rowKeys,
  variableErrors,
  type HeaderRow,
  type VariableRow,
} from "./connection-form";
import { ConnectionVariables } from "./ConnectionVariables";
import { HeaderRows } from "./HeaderRows";
import { useCreateApi } from "./queries";
import type { Api } from "./types";

/** "New API", in the page beside the rail: name, description, base URL, the variables steps use
 * as `{{var.name}}` (each plain or secret) and the default headers. Mounted only while open. */
export function NewApiForm({
  onClose,
  onCreated,
  onDirtyChange,
}: {
  onClose: () => void;
  onCreated: (api: Api) => void;
  /** Whether anything was typed, so leaving can ask first. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const headingId = useId();
  const create = useCreateApi();
  const [nextKey] = useState(() => rowKeys("row"));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  const [variables, setVariables] = useState<VariableRow[]>([]);
  const [local, setLocal] = useState<Record<string, string>>({});
  const dirty = Boolean(name || description || baseUrl || variables.length || headers.length);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const view = create.isError ? localizeFormError(t, create.error, formErrorView(create.error, t("apis.error.taken"))) : undefined;
  const errors = { ...view?.fieldErrors, ...local };
  const variableErrorsView = variableErrors(view?.fieldErrors ?? {}, variables);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!name.trim()) problems.name = t("apis.error.name");
    if (!baseUrl.trim()) problems.baseUrl = t("apis.error.baseUrl");
    const rows = connectionProblems({ headers, variables });
    if (rows.variables) problems.variables = t(`apis.error.rows.${rows.variables}`);
    if (rows.headers) problems.headers = t(`apis.error.rows.${rows.headers}`);
    setLocal(problems);
    if (Object.keys(problems).length > 0) return;
    create.reset();
    try {
      const api = await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        baseUrl: baseUrl.trim(),
        ...newConnection({ headers, variables }),
      });
      onCreated(api);
    } catch {
      // shown in the form
    }
  }

  return (
    <Card aria-labelledby={headingId} className="min-w-0 flex-1">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-[17px] font-semibold">
          {t("apis.newTitle")}
        </h2>
        <p className="text-sm text-muted">{t("apis.newDescription")}</p>
      </div>
      <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        {view?.message ? <Alert>{view.message}</Alert> : null}
        <Field label={t("apis.field.name")} error={errors.name}>
          {(props) => <Input {...props} value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label={t("apis.field.description")} error={errors.description}>
          {(props) => (
            <Textarea {...props} rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
          )}
        </Field>
        <Field label={t("apis.field.baseUrl")} hint={t("apis.baseUrlHint")} error={errors.baseUrl}>
          {(props) => (
            <Input
              {...props}
              mono
              type="url"
              placeholder="https://api.example.com/v1"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          )}
        </Field>
        <ConnectionVariables
          rows={variables}
          onChange={setVariables}
          onAdd={() => setVariables((rows) => [...rows, newVariable(nextKey())])}
          error={local.variables ?? variableErrorsView.section}
          rowErrors={variableErrorsView.byName}
          hint={t("apis.variablesHint")}
          hints={{}}
        />
        <HeaderRows
          rows={headers}
          onChange={setHeaders}
          onAdd={() => setHeaders((rows) => [...rows, { key: nextKey(), name: "", value: "" }])}
          error={fieldError(errors, "headers")}
          hint={t("apis.headersHint")}
        />
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => (!dirty || confirmLeave()) && onClose()}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" loading={create.isPending}>
            {t("apis.create")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
