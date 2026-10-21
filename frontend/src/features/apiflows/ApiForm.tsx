"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { FieldErrors } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, Card, Field, Input, Textarea } from "@/ui";
import {
  apiChanges,
  connectionProblems,
  connectionRows,
  fieldError,
  newVariable,
  rowKeys,
  typedNewVariables,
  variableErrors,
  type HeaderRow,
  type VariableRow,
} from "./connection-form";
import { ConnectionVariables } from "./ConnectionVariables";
import { HeaderRows } from "./HeaderRows";
import type { Api, ApiChanges } from "./types";
import { useSecretReveal } from "./use-secret-reveal";

type ApiFormProps = {
  api: Api;
  /** The header's Save button submits this form through its `form` attribute. */
  formId: string;
  /** Receives only what changed; nothing typed means an empty object. */
  onSubmit: (changes: ApiChanges) => void;
  /** Form-level error of the last failed save. */
  error?: string;
  /** Per-field errors of the last failed save. */
  serverFieldErrors?: FieldErrors;
  /** Whether the form holds edits not saved yet. */
  onDirtyChange?: (dirty: boolean) => void;
};

/**
 * The open API's details on `/apis`, edited in place in cards: its name, description, tags and
 * base URL; its variables, each plain or secret (revealed one at a time, replaced or removed),
 * which steps use as `{{var.name}}`; and the default headers every step sends.
 * Keyed by the caller per API and per save, so it always starts from what is stored, and a
 * revealed value never outlives a save or a switch to another API.
 */
export function ApiForm({ api, formId, onSubmit, error, serverFieldErrors, onDirtyChange }: ApiFormProps) {
  const t = useT();
  const reveal = useSecretReveal(api.id);
  const [nextKey] = useState(() => rowKeys("row"));
  const [name, setName] = useState(api.name);
  const [description, setDescription] = useState(api.description);
  const [tags, setTags] = useState(api.tags.join(", "));
  const [baseUrl, setBaseUrl] = useState(api.baseUrl);
  const [initial] = useState(() => connectionRows(api, nextKey));
  const [headers, setHeaders] = useState<HeaderRow[]>(initial.headers);
  // Stored variables still kept (a stored secret's value empty unless replaced), then new ones.
  const [variables, setVariables] = useState<VariableRow[]>(initial.variables);
  const [local, setLocal] = useState<Record<string, string>>({});

  const errors = { ...serverFieldErrors, ...local };
  const form = { name, description, tags, baseUrl, headers, variables };
  const dirty = Object.keys(apiChanges(api, form)).length > 0 || typedNewVariables(variables);
  const variableErrorsView = variableErrors(serverFieldErrors ?? {}, variables);

  const dirtyHandler = useRef(onDirtyChange);
  useEffect(() => {
    dirtyHandler.current = onDirtyChange;
  });
  useEffect(() => {
    dirtyHandler.current?.(dirty);
  }, [dirty]);
  // Leaving (another API, a delete, the create form) leaves nothing unsaved behind.
  useEffect(() => () => dirtyHandler.current?.(false), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const problems: Record<string, string> = {};
    if (!name.trim()) problems.name = t("apis.error.name");
    if (!baseUrl.trim()) problems.baseUrl = t("apis.error.baseUrl");
    const rows = connectionProblems(form);
    if (rows.variables) problems.variables = t(`apis.error.rows.${rows.variables}`);
    if (rows.headers) problems.headers = t(`apis.error.rows.${rows.headers}`);
    setLocal(problems);
    if (Object.keys(problems).length > 0) return;
    onSubmit(apiChanges(api, form));
  }

  const hints = Object.fromEntries(api.secrets.map((secret) => [secret.name, secret.hint]));

  return (
    <form id={formId} noValidate aria-label={t("apis.settings")} onSubmit={submit} className="flex flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}

      <SectionCard title={t("apis.connection")} subtitle={t("apis.connectionHint")}>
        <Field label={t("apis.field.name")} error={errors.name}>
          {(props) => <Input {...props} value={name} maxLength={160} onChange={(event) => setName(event.target.value)} />}
        </Field>
        <Field label={t("apis.field.description")} error={errors.description}>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              placeholder={t("apis.descriptionPlaceholder")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
        <Field label={t("apis.field.baseUrl")} hint={t("apis.baseUrlHint")} error={errors.baseUrl}>
          {(props) => (
            <Input {...props} mono type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          )}
        </Field>
        <Field label={t("apis.field.tags")} hint={t("apis.tagsHint")} error={fieldError(errors, "tags")}>
          {(props) => <Input {...props} value={tags} placeholder="shop, nightly" onChange={(event) => setTags(event.target.value)} />}
        </Field>
      </SectionCard>

      <SectionCard title={t("apis.variables")} subtitle={t("apis.variablesHint")}>
        <ConnectionVariables
          rows={variables}
          onChange={setVariables}
          onAdd={() => setVariables((rows) => [...rows, newVariable(nextKey())])}
          error={local.variables ?? variableErrorsView.section}
          rowErrors={variableErrorsView.byName}
          legendSrOnly
          hints={hints}
          reveal={reveal}
        />
        {reveal.error ? (
          <p role="alert" className="text-xs text-danger-fg">
            {t("apis.revealFailed", { error: reveal.error })}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard title={t("apis.field.headers")} subtitle={t("apis.headersHint")}>
        <HeaderRows
          rows={headers}
          onChange={setHeaders}
          onAdd={() => setHeaders((rows) => [...rows, { key: nextKey(), name: "", value: "" }])}
          error={fieldError(errors, "headers")}
          legendSrOnly
        />
      </SectionCard>
    </form>
  );
}

/** One of the detail's cards: a titled region, like the agent's. */
function SectionCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <Card aria-labelledby={headingId} className="gap-3.5">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-[15px] font-semibold">
          {title}
        </h2>
        <p className="text-xs text-dim">{subtitle}</p>
      </div>
      {children}
    </Card>
  );
}
