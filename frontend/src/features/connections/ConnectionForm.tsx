"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { get, useForm, useWatch, type Path } from "react-hook-form";
import { Alert, Badge, Button, Field, Input, PasswordInput, Select } from "@/ui";
import type { FieldErrors } from "@/lib/api";
import { useT } from "@/lib/i18n";
import {
  connectionFormSchema,
  draftIssues,
  hasTypedSecret,
  initialValues,
  valuesForKind,
  type ConnectionFormValues,
} from "./form-schema";
import { KINDS } from "./kinds";
import { CONNECTION_KINDS, type Connection, type ConnectionKind, type LastTest } from "./types";

export type TestTarget = "draft" | "stored";

const NO_SERVER_ERRORS: FieldErrors = {};
export type TestOutcome = { result: LastTest; target: TestTarget };

type ConnectionFormProps = {
  /** Present when editing: its kind is fixed and its secret is never shown. */
  connection?: Connection;
  onSubmit: (values: ConnectionFormValues) => void;
  onCancel: () => void;
  onTest: (values: ConnectionFormValues, target: TestTarget) => void;
  pending: boolean;
  testing: boolean;
  testOutcome?: TestOutcome;
  /** Form-level error from the last save or test. */
  error?: string;
  /**
   * Per-field errors from the server (409, 422), keyed by API location (`config.endpoint`).
   * Shown on their field until the user edits it; pass a new object only for a new failure.
   */
  serverFieldErrors?: FieldErrors;
};

/** Presentational: validates locally and reports values; knows nothing about the API. */
export function ConnectionForm({
  connection,
  onSubmit,
  onCancel,
  onTest,
  pending,
  testing,
  testOutcome,
  error,
  serverFieldErrors = NO_SERVER_ERRORS,
}: ConnectionFormProps) {
  const t = useT();
  const editing = connection !== undefined;
  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<ConnectionFormValues>({
    resolver: zodResolver(connectionFormSchema(t, { secretRequired: !editing })),
    defaultValues: initialValues(connection),
  });
  const kind = useWatch({ control, name: "kind" });
  const definition = KINDS[kind];
  const secretPath = `secrets.${definition.secret.key}` as const;

  const fieldError = (path: string): string | undefined => (get(errors, path) as { message?: string } | undefined)?.message;

  const knownPaths = new Set(["name", "kind", secretPath, ...definition.config.map((f) => `config.${f.key}`)]);
  const otherServerErrors = Object.entries(serverFieldErrors)
    .filter(([path]) => !knownPaths.has(path))
    .map(([, message]) => message);

  // Server field errors live in the form state, so editing a field clears its error (below).
  useEffect(() => {
    for (const [path, message] of Object.entries(serverFieldErrors)) {
      if (path === "kind" || path === "name" || path.startsWith("config.") || path.startsWith("secrets.")) {
        setError(path as Path<ConnectionFormValues>, { type: "server", message });
      }
    }
  }, [serverFieldErrors, setError]);

  /** `register` with the field's error cleared on every edit (validation may set it again). */
  const registerField = (path: Path<ConnectionFormValues>) =>
    register(path, { onChange: () => clearErrors(path) });

  function onKindChange(next: ConnectionKind) {
    const fresh = valuesForKind(next);
    setValue("config", fresh.config);
    setValue("secrets", fresh.secrets);
    clearErrors(["config", "secrets"]);
  }

  function runTest() {
    const values = getValues();
    if (editing && !hasTypedSecret(values)) {
      onTest(values, "stored");
      return;
    }
    clearErrors(["config", "secrets"]);
    const issues = draftIssues(t, values, { secretRequired: true });
    for (const issue of issues) {
      setError(issue.path as Path<ConnectionFormValues>, { type: "manual", message: issue.message });
    }
    if (issues.length === 0) onTest(values, "draft");
  }

  const secretHint = !editing
    ? t("connections.secretHintNew")
    : connection.hasSecret
      ? t("connections.secretHintStored", { hint: connection.secretHint ?? "" })
      : t("connections.secretHintNone");

  return (
    <form noValidate aria-label={t("agents.connection")} onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">{t("connections.provider")}</span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{definition.label}</Badge>
            <span className="text-xs text-dim">{t("connections.providerFixed")}</span>
          </div>
        </div>
      ) : (
        <Field label={t("connections.provider")} hint={t(definition.description)} error={fieldError("kind")}>
          {(controlProps) => (
            <Select
              {...controlProps}
              {...register("kind", {
                onChange: (event) => {
                  clearErrors("kind");
                  onKindChange(event.target.value as ConnectionKind);
                },
              })}
            >
              {CONNECTION_KINDS.map((option) => (
                <option key={option} value={option}>
                  {KINDS[option].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <Field label={t("scenarios.field.name")} hint={t("connections.nameHint")} error={fieldError("name")}>
        {(controlProps) => <Input autoComplete="off" {...controlProps} {...registerField("name")} />}
      </Field>

      {definition.config.map((field) => {
        const path = `config.${field.key}` as const;
        return (
          <Field
            key={`${kind}.${field.key}`}
            label={t(field.label)}
            hint={field.hint ? t(field.hint) : undefined}
            error={fieldError(path)}
          >
            {(controlProps) => (
              <Input
                mono
                type={field.format === "url" ? "url" : "text"}
                inputMode={field.format === "url" ? "url" : undefined}
                autoComplete="off"
                spellCheck={false}
                placeholder={field.placeholder}
                {...controlProps}
                {...registerField(path)}
              />
            )}
          </Field>
        );
      })}

      <Field key={`${kind}.secret`} label={t(definition.secret.label)} hint={secretHint} error={fieldError(secretPath)}>
        {(controlProps) => (
          <PasswordInput
            mono
            subject={t(definition.secret.label)}
            autoComplete="new-password"
            spellCheck={false}
            {...controlProps}
            {...registerField(secretPath)}
          />
        )}
      </Field>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {editing ? t("connections.testEditHint") : t("connections.testNewHint")}
          </p>
          <Button variant="secondary" loading={testing} onClick={runTest}>
            {testing ? t("check.testing") : t("connections.test")}
          </Button>
        </div>
        {testOutcome ? (
          <Alert tone={testOutcome.result.ok ? "success" : "danger"} title={testOutcome.result.ok ? t("connections.testPassed") : t("connections.testFailed")}>
            <span className="block">{testOutcome.result.detail}</span>
            {testOutcome.target === "stored" ? (
              <span className="block text-xs text-muted">{t("connections.testedStored")}</span>
            ) : null}
          </Alert>
        ) : null}
      </div>

      {error || otherServerErrors.length > 0 ? (
        <Alert>
          {error ? <span className="block">{error}</span> : null}
          {otherServerErrors.map((message) => (
            <span key={message} className="block">
              {message}
            </span>
          ))}
        </Alert>
      ) : null}

      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={pending}>
          {pending ? t("editor.saving") : editing ? t("agents.saveChanges") : t("connections.create")}
        </Button>
      </div>
    </form>
  );
}
