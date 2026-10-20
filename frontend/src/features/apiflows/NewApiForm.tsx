"use client";

import { useId, useState, type FormEvent } from "react";
import { formErrorView } from "@/lib/api";
import { localizeFormError, useT } from "@/lib/i18n";
import { Alert, Button, Card, Field, Input, Textarea } from "@/ui";
import { MAX_SECRETS, fieldError, headersOf, rowKeys, rowsProblem, secretsOf, type PairRow } from "./connection-form";
import { PairRows } from "./PairRows";
import { useCreateApi } from "./queries";
import type { Api } from "./types";

/** "New API", in the page beside the rail: name, description, base URL, secrets and plain
 * headers. Mounted only while open. */
export function NewApiForm({ onClose, onCreated }: { onClose: () => void; onCreated: (api: Api) => void }) {
  const t = useT();
  const headingId = useId();
  const create = useCreateApi();
  const [nextKey] = useState(() => rowKeys("row"));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [secrets, setSecrets] = useState<PairRow[]>([]);
  const [headers, setHeaders] = useState<PairRow[]>([]);
  const [local, setLocal] = useState<Record<string, string>>({});

  const view = create.isError ? localizeFormError(t, create.error, formErrorView(create.error, t("apis.error.taken"))) : undefined;
  const errors = { ...view?.fieldErrors, ...local };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!name.trim()) problems.name = t("apis.error.name");
    if (!baseUrl.trim()) problems.baseUrl = t("apis.error.baseUrl");
    const secretProblem = rowsProblem(secrets, "secret");
    if (secretProblem) problems.secrets = t(`apis.error.rows.${secretProblem}`);
    const headerProblem = rowsProblem(headers, "header");
    if (headerProblem) problems.headers = t(`apis.error.rows.${headerProblem}`);
    setLocal(problems);
    if (Object.keys(problems).length > 0) return;
    create.reset();
    try {
      const api = await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        baseUrl: baseUrl.trim(),
        headers: headersOf(headers),
        secrets: secretsOf(secrets),
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
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
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
