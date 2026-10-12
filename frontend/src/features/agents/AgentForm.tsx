"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { get, useForm, useWatch, type Path } from "react-hook-form";
import type { FieldErrors } from "@/lib/api";
import { Alert, Badge, Button, Card, Field, Input, Select, Textarea } from "@/ui";
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

export type LangfuseOption = {
  id: string;
  name: string;
  /** Where the connection reads traces from (its `host`), when known. */
  host?: string;
};

type AgentFormProps = {
  /** Present when editing. */
  agent?: Agent;
  /** Connections of kind `langfuse` the agent may link to. */
  langfuseOptions: LangfuseOption[];
  /** Shown under the Langfuse select (e.g. when the connections could not be loaded). */
  langfuseHint?: string;
  onSubmit: (values: AgentFormValues) => void;
  /** Dialog only. */
  onCancel?: () => void;
  pending: boolean;
  /** Form-level error from the last save. */
  error?: string;
  /**
   * Per-field errors from the server (409, 422), keyed by API location (`baseUrl`). Shown on
   * their field until the user edits it; pass a new object only for a new failure.
   */
  serverFieldErrors?: FieldErrors;
  /**
   * `dialog` (default): one column with its own Cancel/Create buttons. `cards`: the agent's
   * detail page, grouped in the design's cards; the page header submits it through `formId`.
   */
  layout?: "dialog" | "cards";
  /** The form's id, for a submit button outside it (`<button form>`). */
  formId?: string;
  /** Cards only: the reachability pill of the realtime connection card. */
  connectionStatus?: ReactNode;
  /** Cards only: the connection check (log and test button) closing the realtime card. */
  connectionCheck?: ReactNode;
  /** Cards only: cards shown after the form's own (e.g. where evaluator settings live). */
  extraCards?: ReactNode;
  /** Told whether the form holds unsaved edits (false again once it unmounts). */
  onDirtyChange?: (dirty: boolean) => void;
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
  layout = "dialog",
  formId,
  connectionStatus,
  connectionCheck,
  extraCards,
  onDirtyChange,
}: AgentFormProps) {
  const editing = agent !== undefined;
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    setValue,
    clearErrors,
    control,
    formState: { errors, isDirty },
  } = useForm<AgentFormValues>({ resolver: zodResolver(agentFormSchema), defaultValues: initialValues(agent) });

  const dirtyHandler = useRef(onDirtyChange);
  useEffect(() => {
    dirtyHandler.current = onDirtyChange;
  });
  useEffect(() => {
    dirtyHandler.current?.(isDirty);
  }, [isDirty]);
  useEffect(() => () => dirtyHandler.current?.(false), []);

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


  const formUid = useId();
  const selectedLangfuse = useWatch({ control, name: "langfuseConnectionId" });
  const linkedOption = options.find((option) => option.id === selectedLangfuse);
  const cards = layout === "cards";

  const importBlock = (
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
  );

  const nameField = (
    <Field label="Name" hint="Unique; scenarios and runs refer to the agent by it." error={fieldError("name")}>
      {(control) => <Input autoComplete="off" {...control} {...registerField("name")} />}
    </Field>
  );

  const contextField = (
    <Field
      label="What this agent does — shared by all its scenarios"
      hint="The evaluator and the judge read this before every scenario run against this agent."
      error={fieldError("context")}
    >
      {(control) => <Textarea rows={5} {...control} {...registerField("context")} />}
    </Field>
  );

  const protocolField = (
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
  );

  const baseUrlField = (
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
  );

  const originField = (label: string) => (
    <Field
      label={label}
      hint="Optional. Sent as the Origin header when the agent checks it, like https://app.example.com."
      error={fieldError("origin")}
    >
      {(control) => (
        <Input mono inputMode="url" autoComplete="off" spellCheck={false} {...control} {...registerField("origin")} />
      )}
    </Field>
  );

  const langfuseField = (
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
  );

  const errorAlert =
    error || otherServerErrors.length > 0 ? (
      <Alert>
        {error ? <span className="block">{error}</span> : null}
        {otherServerErrors.map((message) => (
          <span key={message} className="block">
            {message}
          </span>
        ))}
      </Alert>
    ) : null;

  /** A fixed connection parameter edited inside the parameters table. */
  const paramInput = (path: "channelId" | "userId", label: string) => {
    const message = fieldError(path);
    const errorId = `${formUid}-${path}-error`;
    return (
      <>
        <Input
          mono
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? errorId : undefined}
          {...registerField(path)}
        />
        {message ? (
          <p id={errorId} className="mt-1.5 text-xs text-danger-fg">
            {message}
          </p>
        ) : null}
      </>
    );
  };

  if (cards) {
    return (
      <form
        id={formId}
        noValidate
        aria-label="Agent settings"
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        {errorAlert}
        <SectionCard
          title="Realtime connection"
          subtitle="Each run opens its own socket with a fresh threadId"
          status={connectionStatus}
        >
          {importBlock}
          {baseUrlField}
          <ParamsTable
            channelId={paramInput("channelId", "Channel ID")}
            userId={paramInput("userId", "User ID")}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {originField("Origin header")}
            {protocolField}
          </div>
          {connectionCheck}
        </SectionCard>
        <SectionCard
          title="Langfuse traces"
          subtitle="Fetched after each call and handed to the judge with the transcript"
          status={
            selectedLangfuse ? (
              <Badge tone="success">
                <span aria-hidden="true" className="size-[7px] rounded-full bg-success" />
                Linked
              </Badge>
            ) : (
              <Badge tone="muted">Not linked</Badge>
            )
          }
        >
          {langfuseField}
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <dt className="text-xs font-medium text-muted">Host</dt>
              <dd className="min-h-11 break-all rounded-lg border border-field-line bg-field px-3 py-3 font-mono text-[13px]">
                {selectedLangfuse ? (linkedOption?.host ?? "Unknown") : "—"}
              </dd>
            </div>
            <div className="flex flex-col gap-1.5">
              <dt className="text-xs font-medium text-muted">Match traces by</dt>
              <dd className="min-h-11 rounded-lg border border-field-line bg-field px-3 py-3 text-sm">
                Matched by threadId (session id)
              </dd>
            </div>
          </dl>
          <p className="text-xs text-dim">
            After a call ends, the judge waits up to 20 minutes for its traces to reach Langfuse before it scores the run.
          </p>
        </SectionCard>
        <SectionCard title="Agent context" subtitle="Shared by every scenario written against this agent">
          {nameField}
          {contextField}
        </SectionCard>
        {extraCards}
      </form>
    );
  }

  return (
    <form id={formId} noValidate aria-label="Agent" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      {importBlock}
      {nameField}
      {contextField}

      <fieldset className="flex flex-col gap-4 rounded-lg border border-line bg-raised p-4">
        <legend className="px-1 text-sm font-semibold">Connection</legend>
        <p className="text-xs text-muted">Each run opens its own socket with a fresh thread ID.</p>
        {protocolField}
        {baseUrlField}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Channel ID" error={fieldError("channelId")}>
            {(control) => <Input mono autoComplete="off" spellCheck={false} {...control} {...registerField("channelId")} />}
          </Field>
          <Field label="User ID" error={fieldError("userId")}>
            {(control) => <Input mono autoComplete="off" spellCheck={false} {...control} {...registerField("userId")} />}
          </Field>
        </div>
        {originField("Origin (optional)")}
      </fieldset>

      {langfuseField}
      {errorAlert}

      <div className="flex flex-wrap justify-end gap-3">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create agent"}
        </Button>
      </div>
    </form>
  );
}

type SectionCardProps = { title: string; subtitle: string; status?: ReactNode; children: ReactNode };

/** One of the detail's cards: a titled region with an optional status pill on the right. */
function SectionCard({ title, subtitle, status, children }: SectionCardProps) {
  const headingId = useId();
  return (
    <Card aria-labelledby={headingId} className="gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-[15px] font-semibold">
            {title}
          </h2>
          <p className="text-xs text-dim">{subtitle}</p>
        </div>
        {status}
      </div>
      {children}
    </Card>
  );
}

const PARAM_CELL = "border-b border-line-soft px-2.5 py-2.5 align-top";

/** The values every run sends: channel and user are fixed; the thread ID is new per run. */
function ParamsTable({ channelId, userId }: { channelId: ReactNode; userId: ReactNode }) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-xs font-medium text-muted">
        Connection parameters
      </span>
      <div className="overflow-x-auto">
        <table aria-labelledby={labelId} className="w-full min-w-[520px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-dim">
              <th scope="col" className="border-b border-line px-2.5 py-2 font-medium">Key</th>
              <th scope="col" className="border-b border-line px-2.5 py-2 font-medium">Value</th>
              <th scope="col" className="border-b border-line px-2.5 py-2 font-medium">Per run</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" className={`${PARAM_CELL} pt-5 text-left font-mono text-xs font-normal`}>channelId</th>
              <td className={PARAM_CELL}>{channelId}</td>
              <td className={`${PARAM_CELL} pt-4`}>
                <Badge tone="muted">Fixed</Badge>
              </td>
            </tr>
            <tr>
              <th scope="row" className={`${PARAM_CELL} pt-5 text-left font-mono text-xs font-normal`}>userId</th>
              <td className={PARAM_CELL}>{userId}</td>
              <td className={`${PARAM_CELL} pt-4`}>
                <Badge tone="muted">Fixed</Badge>
              </td>
            </tr>
            <tr>
              <th scope="row" className={`${PARAM_CELL} text-left font-mono text-xs font-normal`}>threadId</th>
              <td className={`${PARAM_CELL} font-mono text-xs text-body`}>new UUID</td>
              <td className={PARAM_CELL}>
                <Badge tone="evaluator">Generated per run</Badge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
