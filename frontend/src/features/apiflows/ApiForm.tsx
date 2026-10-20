"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { FieldErrors } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Alert, Button, Card, Field, Input, PasswordInput, Textarea } from "@/ui";
import { MAX_SECRETS, apiChanges, fieldError, rowKeys, rowsProblem, type PairRow } from "./connection-form";
import { PairRows } from "./PairRows";
import { SecretChip } from "./SecretChip";
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
 * base URL; its secrets (revealed one at a time, replaced, removed or added); its plain headers.
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
  const [headers, setHeaders] = useState<PairRow[]>(() => api.headers.map((header) => ({ key: nextKey(), ...header })));
  // Stored secrets still kept, each with the new value typed (empty leaves it as it is).
  const [stored, setStored] = useState<PairRow[]>(() =>
    api.secrets.map((secret) => ({ key: nextKey(), name: secret.name, value: "", locked: true })),
  );
  const [added, setAdded] = useState<PairRow[]>([]);
  const [local, setLocal] = useState<Record<string, string>>({});

  const errors = { ...serverFieldErrors, ...local };
  const secrets = [...stored, ...added];
  const form = { name, description, tags, baseUrl, headers, secrets };
  const dirty = Object.keys(apiChanges(api, form)).length > 0 || added.some((row) => row.name.trim() || row.value);

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
    const secretProblem = rowsProblem(secrets, "secret");
    if (secretProblem) problems.secrets = t(`apis.error.rows.${secretProblem}`);
    const headerProblem = rowsProblem(headers, "header");
    if (headerProblem) problems.headers = t(`apis.error.rows.${headerProblem}`);
    setLocal(problems);
    if (Object.keys(problems).length > 0) return;
    onSubmit(apiChanges(api, form));
  }

  const setStoredValue = (key: string, value: string) =>
    setStored((rows) => rows.map((row) => (row.key === key ? { ...row, value } : row)));
  const hints = new Map(api.secrets.map((secret) => [secret.name, secret.hint]));

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

      <SectionCard title={t("apis.field.secrets")} subtitle={t("apis.secretsHint")}>
        {stored.length > 0 ? (
          <ul aria-label={t("apis.storedSecrets")} className="flex flex-col gap-2">
            {stored.map((row) => (
              <li
                key={row.key}
                className="grid items-center gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]"
              >
                <span className="min-w-0">
                  <SecretChip
                    name={row.name}
                    hint={hints.get(row.name) ?? ""}
                    value={reveal.shown[row.name]}
                    pending={reveal.pending.has(row.name)}
                    onToggle={() => void reveal.toggle(row.name)}
                  />
                </span>
                <PasswordInput
                  mono
                  aria-label={t("apis.secretNewValue", { name: row.name })}
                  subject={t("apis.secretNewValue", { name: row.name })}
                  autoComplete="new-password"
                  placeholder={t("apis.replaceValue")}
                  value={row.value}
                  onChange={(event) => setStoredValue(row.key, event.target.value)}
                />
                <Button
                  variant="ghost"
                  aria-label={t("apis.removeSecret", { name: row.name })}
                  onClick={() => setStored((rows) => rows.filter((item) => item.key !== row.key))}
                >
                  {t("apis.remove")}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {reveal.error ? (
          <p role="alert" className="text-xs text-danger-fg">
            {t("apis.revealFailed", { error: reveal.error })}
          </p>
        ) : null}
        <PairRows
          kind="secret"
          rows={added}
          onChange={setAdded}
          onAdd={() => setAdded((rows) => [...rows, { key: nextKey(), name: "", value: "" }])}
          error={fieldError(errors, "secrets")}
          max={MAX_SECRETS - stored.length}
          legend={t("apis.newSecrets")}
          legendSrOnly={added.length === 0}
          emptyText={stored.length > 0 ? null : undefined}
        />
      </SectionCard>

      <SectionCard title={t("apis.field.headers")} subtitle={t("apis.headersHint")}>
        <PairRows
          kind="header"
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
