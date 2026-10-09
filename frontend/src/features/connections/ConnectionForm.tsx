"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { get, useForm, useWatch, type Path } from "react-hook-form";
import { Alert, Badge, Button, Field, Input, PasswordInput, Select } from "@/ui";
import type { FieldErrors } from "@/lib/api";
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
  /** Per-field errors from the server (409, 422), keyed by API location (`config.endpoint`). */
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
  serverFieldErrors = {},
}: ConnectionFormProps) {
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
    resolver: zodResolver(connectionFormSchema({ secretRequired: !editing })),
    defaultValues: initialValues(connection),
  });
  const kind = useWatch({ control, name: "kind" });
  const definition = KINDS[kind];
  const secretPath = `secrets.${definition.secret.key}` as const;

  const fieldError = (path: string): string | undefined =>
    (get(errors, path) as { message?: string } | undefined)?.message ?? serverFieldErrors[path];

  const knownPaths = new Set(["name", "kind", secretPath, ...definition.config.map((f) => `config.${f.key}`)]);
  const otherServerErrors = Object.entries(serverFieldErrors)
    .filter(([path]) => !knownPaths.has(path))
    .map(([, message]) => message);

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
    const issues = draftIssues(values, { secretRequired: true });
    for (const issue of issues) {
      setError(issue.path as Path<ConnectionFormValues>, { type: "manual", message: issue.message });
    }
    if (issues.length === 0) onTest(values, "draft");
  }

  const secretHint = !editing
    ? "Stored encrypted. Only its last 4 characters are ever shown."
    : connection.hasSecret
      ? `Stored key ${connection.secretHint} — leave blank to keep it`
      : "No key stored. Enter one to use this connection.";

  return (
    <form noValidate aria-label="Connection" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted">Provider</span>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{definition.label}</Badge>
            <span className="text-xs text-dim">The provider of a connection cannot change.</span>
          </div>
        </div>
      ) : (
        <Field label="Provider" hint={definition.description} error={fieldError("kind")}>
          {(controlProps) => (
            <Select
              {...controlProps}
              {...register("kind", { onChange: (event) => onKindChange(event.target.value as ConnectionKind) })}
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

      <Field label="Name" hint="Unique; runs refer to the connection by it." error={fieldError("name")}>
        {(controlProps) => <Input autoComplete="off" {...controlProps} {...register("name")} />}
      </Field>

      {definition.config.map((field) => {
        const path = `config.${field.key}` as const;
        return (
          <Field key={`${kind}.${field.key}`} label={field.label} hint={field.hint} error={fieldError(path)}>
            {(controlProps) => (
              <Input
                mono
                type={field.format === "url" ? "url" : "text"}
                inputMode={field.format === "url" ? "url" : undefined}
                autoComplete="off"
                spellCheck={false}
                placeholder={field.placeholder}
                {...controlProps}
                {...register(path)}
              />
            )}
          </Field>
        );
      })}

      <Field key={`${kind}.secret`} label={definition.secret.label} hint={secretHint} error={fieldError(secretPath)}>
        {(controlProps) => (
          <PasswordInput
            mono
            subject={definition.secret.label}
            autoComplete="new-password"
            spellCheck={false}
            {...controlProps}
            {...register(secretPath)}
          />
        )}
      </Field>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {editing
              ? "Leave the key blank to test the saved connection, or type a key to test these values."
              : "Checks these values against the provider without saving them."}
          </p>
          <Button variant="secondary" loading={testing} onClick={runTest}>
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </div>
        {testOutcome ? (
          <Alert tone={testOutcome.result.ok ? "success" : "danger"} title={testOutcome.result.ok ? "Test passed" : "Test failed"}>
            <span className="block">{testOutcome.result.detail}</span>
            {testOutcome.target === "stored" ? (
              <span className="block text-xs text-muted">Tested the saved connection; unsaved changes were not included.</span>
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
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create connection"}
        </Button>
      </div>
    </form>
  );
}
