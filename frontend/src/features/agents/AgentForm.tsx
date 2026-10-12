"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useState } from "react";
import { get, useForm, type Path } from "react-hook-form";
import type { FieldErrors } from "@/lib/api";
import { Alert, Button, Field, Input, Select, Textarea } from "@/ui";
import {
  AGENT_FIELDS,
  agentFormSchema,
  initialValues,
  PROTOCOL_LABELS,
  type AgentFormValues,
} from "./form-schema";
import { CurlImportPanel, type CurlImportSuccess } from "./CurlImportPanel";
import { AGENT_PROTOCOLS, type Agent } from "./types";

const NO_SERVER_ERRORS: FieldErrors = {};

/** How the import summary names each field it filled, in form order. */
const IMPORTED_FIELD_LABELS = {
  baseUrl: "WebSocket URL",
  channelId: "channel ID",
  userId: "user ID",
  origin: "origin",
} as const;

type ImportSummary = { filled: string[]; ignored: string[]; warnings: string[] };

export type LangfuseOption = { id: string; name: string };

type AgentFormProps = {
  /** Present when editing. */
  agent?: Agent;
  /** Connections of kind `langfuse` the agent may link to. */
  langfuseOptions: LangfuseOption[];
  /** Shown under the Langfuse select (e.g. when the connections could not be loaded). */
  langfuseHint?: string;
  onSubmit: (values: AgentFormValues) => void;
  onCancel: () => void;
  pending: boolean;
  /** Form-level error from the last save. */
  error?: string;
  /**
   * Per-field errors from the server (409, 422), keyed by API location (`baseUrl`). Shown on
   * their field until the user edits it; pass a new object only for a new failure.
   */
  serverFieldErrors?: FieldErrors;
};

/** Presentational: validates locally and reports values; knows nothing about the API. */
export function AgentForm({
  agent,
  langfuseOptions,
  langfuseHint,
  onSubmit,
  onCancel,
  pending,
  error,
  serverFieldErrors = NO_SERVER_ERRORS,
}: AgentFormProps) {
  const editing = agent !== undefined;
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    setValue,
    clearErrors,
    formState: { errors },
  } = useForm<AgentFormValues>({ resolver: zodResolver(agentFormSchema), defaultValues: initialValues(agent) });

  const importPanelId = useId();
  const importToggleId = useId();
  const [importOpen, setImportOpen] = useState(false);
  const [importSummary, setImportSummary] = useState<ImportSummary>();

  function closeImport() {
    setImportOpen(false);
    document.getElementById(importToggleId)?.focus();
  }

  // Fills only what the command provided, as user edits (dirty), so the rest of the form stays.
  function applyImport({ values, ignored, warnings }: CurlImportSuccess) {
    const fields = (Object.keys(IMPORTED_FIELD_LABELS) as (keyof typeof IMPORTED_FIELD_LABELS)[]).filter(
      (field) => values[field] !== undefined,
    );
    for (const field of fields) {
      setValue(field, values[field] ?? "", { shouldDirty: true });
      clearErrors(field);
    }
    setImportSummary({ filled: fields.map((field) => IMPORTED_FIELD_LABELS[field]), ignored, warnings });
    closeImport();
  }

  const known = new Set<string>(AGENT_FIELDS);
  const otherServerErrors = Object.entries(serverFieldErrors)
    .filter(([path]) => !known.has(path))
    .map(([, message]) => message);

  // Server field errors live in the form state, so editing a field clears its error; the first
  // field with one takes focus, like after a failed local validation.
  useEffect(() => {
    const paths = AGENT_FIELDS.filter((path) => serverFieldErrors[path]);
    for (const path of paths) setError(path, { type: "server", message: serverFieldErrors[path] });
    if (paths.length > 0) setFocus(paths[0]);
  }, [serverFieldErrors, setError, setFocus]);

  const fieldError = (path: string): string | undefined =>
    (get(errors, path) as { message?: string } | undefined)?.message;
  const registerField = (path: Path<AgentFormValues>) => register(path, { onChange: () => clearErrors(path) });

  // A stored link to a connection that is not offered (deleted, or the list failed) stays visible.
  const linked = agent?.langfuseConnectionId;
  const options =
    linked && !langfuseOptions.some((option) => option.id === linked)
      ? [...langfuseOptions, { id: linked, name: "Current connection" }]
      : langfuseOptions;

  return (
    <form noValidate aria-label="Agent" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div>
          <Button
            id={importToggleId}
            variant="secondary"
            aria-expanded={importOpen}
            aria-controls={importOpen ? importPanelId : undefined}
            onClick={() => {
              if (importOpen) return closeImport();
              setImportSummary(undefined);
              setImportOpen(true);
            }}
          >
            Import from cURL
          </Button>
        </div>
        {importOpen ? <CurlImportPanel id={importPanelId} onImport={applyImport} onCancel={closeImport} /> : null}
        {importSummary ? (
          <Alert tone="info">
            <span className="block">
              {importSummary.filled.length > 0 ? `Filled: ${importSummary.filled.join(", ")}.` : "Nothing filled."}
              {importSummary.ignored.length > 0 ? ` Ignored: ${importSummary.ignored.join(", ")}.` : null}
            </span>
            {importSummary.warnings.map((warning) => (
              <span key={warning} className="block">
                {warning}
              </span>
            ))}
          </Alert>
        ) : null}
      </div>

      <Field label="Name" hint="Unique; scenarios and runs refer to the agent by it." error={fieldError("name")}>
        {(control) => <Input autoComplete="off" {...control} {...registerField("name")} />}
      </Field>

      <Field
        label="What this agent does — shared by all its scenarios"
        hint="The evaluator and the judge read this before every scenario run against this agent."
        error={fieldError("context")}
      >
        {(control) => <Textarea rows={5} {...control} {...registerField("context")} />}
      </Field>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-line bg-raised p-4">
        <legend className="px-1 text-sm font-semibold">Connection</legend>
        <p className="text-xs text-muted">Each run opens its own socket with a fresh thread ID.</p>
        <Field
          label="Protocol"
          hint="Auto-detect probes the agent on each run; pick one to skip the probe."
          error={fieldError("protocol")}
        >
          {(control) => (
            <Select {...control} {...registerField("protocol")}>
              {AGENT_PROTOCOLS.map((protocol) => (
                <option key={protocol} value={protocol}>
                  {PROTOCOL_LABELS[protocol]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="WebSocket URL"
          hint="wss:// without query string. ws:// works for a local agent (localhost, 127.0.0.1, host.docker.internal)."
          error={fieldError("baseUrl")}
        >
          {(control) => (
            <Input
              mono
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="wss://agent.example.com/ws"
              {...control}
              {...registerField("baseUrl")}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Channel ID" error={fieldError("channelId")}>
            {(control) => <Input mono autoComplete="off" spellCheck={false} {...control} {...registerField("channelId")} />}
          </Field>
          <Field label="User ID" error={fieldError("userId")}>
            {(control) => <Input mono autoComplete="off" spellCheck={false} {...control} {...registerField("userId")} />}
          </Field>
        </div>
        <Field
          label="Origin (optional)"
          hint="Sent as the Origin header when the agent checks it, like https://app.example.com."
          error={fieldError("origin")}
        >
          {(control) => (
            <Input mono inputMode="url" autoComplete="off" spellCheck={false} {...control} {...registerField("origin")} />
          )}
        </Field>
      </fieldset>

      <Field
        label="Langfuse connection"
        hint={langfuseHint ?? "Traces are fetched after each call and handed to the judge."}
        error={fieldError("langfuseConnectionId")}
      >
        {(control) => (
          <Select {...control} {...registerField("langfuseConnectionId")}>
            <option value="">None</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        )}
      </Field>

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
          {pending ? "Saving…" : editing ? "Save changes" : "Create agent"}
        </Button>
      </div>
    </form>
  );
}
