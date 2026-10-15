"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { get, useForm, useWatch, type Path } from "react-hook-form";
import type { FieldErrors } from "@/lib/api";
import { useT, type MessageKey } from "@/lib/i18n";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  PasswordInput,
  RadioCard,
  RadioCardGroup,
  Select,
  Textarea,
} from "@/ui";
import { AGENT_FIELDS, agentFormSchema, initialValues, type AgentFormValues } from "./form-schema";
import { CurlImportPanel, type CurlImportSuccess } from "./CurlImportPanel";
import { AGENT_KINDS, AGENT_PROTOCOLS, TEXT_AUTHS, TEXT_MODES, type Agent, type AgentKind } from "./types";

const NO_SERVER_ERRORS: FieldErrors = {};

/** How the import summary names each field it filled, per kind, in form order. */
const IMPORTED_FIELD_LABELS = {
  voice: {
    baseUrl: "agents.imported.wsUrl",
    channelId: "agents.imported.channelId",
    userId: "agents.imported.userId",
    origin: "agents.imported.origin",
  },
  text: {
    baseUrl: "agents.imported.baseUrl",
    channelId: "agents.imported.channelId",
    textMode: "agents.imported.mode",
    auth: "agents.imported.auth",
    apiKey: "agents.imported.apiKey",
    origin: "agents.imported.origin",
  },
} as const satisfies Record<AgentKind, Partial<Record<keyof AgentFormValues, MessageKey>>>;

type ImportSummary = { filled: string[]; ignored: string[]; warnings: string[]; mismatch?: boolean };

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
  const t = useT();
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
  } = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema(t, agent?.hasApiKey ?? false)),
    defaultValues: initialValues(agent),
  });
  const kind = useWatch({ control, name: "kind" });
  const textMode = useWatch({ control, name: "textMode" });
  const auth = useWatch({ control, name: "auth" });
  const text = kind === "text";
  // A stored key is never shown; "Replace" opens an empty field for a new one.
  const [replacingKey, setReplacingKey] = useState(false);

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
  // A new agent takes the command's kind; an existing one keeps its own and is left untouched.
  function applyImport({ kind: imported, values, ignored, warnings }: CurlImportSuccess) {
    if (imported !== kind && editing) {
      setImportSummary({
        filled: [],
        ignored: [],
        warnings: [
          t("agents.import.mismatch", { imported: t(`agents.aKind.${imported}`), kind: t(`agents.aKind.${kind}`) }),
        ],
        mismatch: true,
      });
      closeImport();
      return;
    }
    const labels: Partial<Record<keyof AgentFormValues, MessageKey>> = IMPORTED_FIELD_LABELS[imported];
    const fields = (Object.keys(labels) as (keyof typeof values)[]).filter((field) => values[field] !== undefined);
    if (imported !== kind) setValue("kind", imported, { shouldDirty: true });
    for (const field of fields) {
      setValue(field, values[field] ?? "", { shouldDirty: true });
      clearErrors(field);
    }
    if (values.apiKey !== undefined) setReplacingKey(true);
    const filled = fields.map((field) => {
      const label = labels[field];
      return label ? t(label) : field;
    });
    if (imported !== kind) filled.unshift(t("agents.imported.kind", { kind: t(`agents.kind.${imported}`).toLowerCase() }));
    setImportSummary({ filled, ignored, warnings });
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
      ? [...langfuseOptions, { id: linked, name: t("scenarios.currentConnection") }]
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
          {t("agents.importCurl")}
        </Button>
      </div>
      {importOpen ? <CurlImportPanel id={importPanelId} onImport={applyImport} onCancel={closeImport} /> : null}
      {importSummary ? (
        <Alert tone="info">
          {importSummary.mismatch ? null : (
            <span className="block">
              {importSummary.filled.length > 0
                ? t("agents.import.filled", { fields: importSummary.filled.join(", ") })
                : t("agents.import.nothing")}
              {importSummary.ignored.length > 0
                ? ` ${t("agents.import.ignored", { fields: importSummary.ignored.join(", ") })}`
                : null}
            </span>
          )}
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
    <Field label={t("scenarios.field.name")} hint={t("agents.field.nameHint")} error={fieldError("name")}>
      {(control) => <Input autoComplete="off" {...control} {...registerField("name")} />}
    </Field>
  );

  const contextField = (
    <Field
      label={t("agents.field.context")}
      hint={t("agents.field.contextHint")}
      error={fieldError("context")}
    >
      {(control) => <Textarea rows={5} {...control} {...registerField("context")} />}
    </Field>
  );

  const protocolField = (
    <Field
      label={t("agents.field.protocol")}
      hint={t("agents.field.protocolHint")}
      error={fieldError("protocol")}
    >
      {(control) => (
        <Select {...control} {...registerField("protocol")}>
          {AGENT_PROTOCOLS.map((protocol) => (
            <option key={protocol} value={protocol}>
              {t(`agents.protocol.${protocol}`)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );

  const baseUrlField = (
    <Field
      label={text ? t("agents.field.baseUrl") : t("agents.field.wsUrl")}
      hint={text ? t("agents.field.baseUrlHint") : t("agents.field.wsUrlHint")}
      error={fieldError("baseUrl")}
    >
      {(control) => (
        <Input
          mono
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder={text ? "https://api.example.com" : "wss://agent.example.com/ws"}
          {...control}
          {...registerField("baseUrl")}
        />
      )}
    </Field>
  );

  const kindField = (
    <RadioCardGroup label={t("agents.field.kind")}>
      {AGENT_KINDS.map((value) => (
        <RadioCard
          key={value}
          name={`${formUid}-kind`}
          value={value}
          checked={kind === value}
          onChange={(next) => {
            setValue("kind", next, { shouldDirty: true });
            clearErrors();
          }}
          title={t(`agents.kind.${value}`)}
          description={t(`agents.kind.${value}Hint`)}
        />
      ))}
    </RadioCardGroup>
  );

  const kindBadge = <Badge tone="outline">{text ? t("runs.textAgent") : t("agents.voiceAgent")}</Badge>;

  const textModeField = (
    <div className="flex flex-col gap-2">
      <span aria-hidden="true" className="text-xs font-medium text-muted">
        {t("report.metric.mode")}
      </span>
      <RadioCardGroup label={t("report.metric.mode")}>
        {TEXT_MODES.map((value) => (
          <RadioCard
            key={value}
            name={`${formUid}-mode`}
            value={value}
            checked={textMode === value}
            onChange={(next) => setValue("textMode", next, { shouldDirty: true })}
            title={t(`runs.textMode.${value}`)}
            description={t(`agents.textMode.${value}Hint`)}
          />
        ))}
      </RadioCardGroup>
    </div>
  );

  const storedKey = agent?.hasApiKey && !replacingKey;
  const authField = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span aria-hidden="true" className="text-xs font-medium text-muted">
          {t("agents.field.auth")}
        </span>
        <RadioCardGroup label={t("agents.field.auth")}>
          {TEXT_AUTHS.map((value) => (
            <RadioCard
              key={value}
              name={`${formUid}-auth`}
              value={value}
              checked={auth === value}
              onChange={(next) => {
                setValue("auth", next, { shouldDirty: true });
                clearErrors("apiKey");
              }}
              title={t(`agents.auth.${value}`)}
              description={t(`agents.auth.${value}Hint`)}
            />
          ))}
        </RadioCardGroup>
      </div>
      {auth !== "api_key" ? null : storedKey ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-field-line bg-field px-3 py-2">
          <span className="font-mono text-[13px]">{t("agents.savedKey", { hint: agent?.apiKeyHint ?? "" })}</span>
          <span className="flex gap-2">
            <Button variant="secondary" onClick={() => setReplacingKey(true)}>
              {t("agents.replace")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setValue("auth", "none", { shouldDirty: true });
                clearErrors("apiKey");
              }}
            >
              {t("agents.remove")}
            </Button>
          </span>
        </div>
      ) : (
        <Field
          label={t("agents.field.apiKey")}
          hint={agent?.hasApiKey ? t("agents.field.apiKeyReplaceHint") : t("agents.field.apiKeyHint")}
          error={fieldError("apiKey")}
        >
          {(control) => (
            <PasswordInput
              mono
              subject={t("agents.apiKeySubject")}
              autoComplete="new-password"
              spellCheck={false}
              {...control}
              {...registerField("apiKey")}
            />
          )}
        </Field>
      )}
    </div>
  );

  const originField = (label: string) => (
    <Field
      label={label}
      hint={t("agents.field.originHint")}
      error={fieldError("origin")}
    >
      {(control) => (
        <Input mono inputMode="url" autoComplete="off" spellCheck={false} {...control} {...registerField("origin")} />
      )}
    </Field>
  );

  const langfuseField = (
    <Field
      label={t("agents.field.langfuse")}
      hint={langfuseHint ?? t("agents.field.langfuseHint")}
      error={fieldError("langfuseConnectionId")}
    >
      {(control) => (
        <Select {...control} {...registerField("langfuseConnectionId")}>
          <option value="">{t("scenarios.none")}</option>
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
        aria-label={t("agents.settings")}
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        {errorAlert}
        <SectionCard
          title={text ? t("agents.chatConnection") : t("agents.realtimeConnection")}
          subtitle={text ? t("agents.chatConnectionHint") : t("agents.realtimeConnectionHint")}
          badge={kindBadge}
          status={connectionStatus}
        >
          {importBlock}
          {baseUrlField}
          <ParamsTable
            fixed={
              text
                ? [{ key: "channelId", input: paramInput("channelId", t("agents.field.channelId")) }]
                : [
                    { key: "channelId", input: paramInput("channelId", t("agents.field.channelId")) },
                    { key: "userId", input: paramInput("userId", t("agents.field.userId")) },
                  ]
            }
          />
          {text ? (
            <>
              {textModeField}
              {authField}
              {originField(t("agents.field.originHeader"))}
            </>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {originField(t("agents.field.originHeader"))}
              {protocolField}
            </div>
          )}
          {connectionCheck}
        </SectionCard>
        <SectionCard
          title={t("agents.langfuseTraces")}
          subtitle={t("agents.langfuseTracesHint")}
          status={
            selectedLangfuse ? (
              <Badge tone="success">
                <span aria-hidden="true" className="size-[7px] rounded-full bg-success" />
                {t("agents.linked")}
              </Badge>
            ) : (
              <Badge tone="muted">{t("agents.notLinked")}</Badge>
            )
          }
        >
          {langfuseField}
          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <dt className="text-xs font-medium text-muted">{t("agents.host")}</dt>
              <dd className="min-h-11 break-all rounded-lg border border-field-line bg-field px-3 py-3 font-mono text-[13px]">
                {selectedLangfuse ? (linkedOption?.host ?? t("agents.unknown")) : "—"}
              </dd>
            </div>
            <div className="flex flex-col gap-1.5">
              <dt className="text-xs font-medium text-muted">{t("agents.matchBy")}</dt>
              <dd className="min-h-11 rounded-lg border border-field-line bg-field px-3 py-3 text-sm">
                {t("agents.matchedByThread")}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-dim">{t("agents.judgeWaits")}</p>
        </SectionCard>
        <SectionCard title={t("scenarios.agentContext")} subtitle={t("agents.contextHint")}>
          {nameField}
          {contextField}
        </SectionCard>
        {extraCards}
      </form>
    );
  }

  return (
    <form id={formId} noValidate aria-label={t("common.agent")} onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
      {editing ? null : kindField}
      {importBlock}
      {nameField}
      {contextField}

      <fieldset className="flex flex-col gap-4 rounded-lg border border-line bg-raised p-4">
        <legend className="px-1 text-sm font-semibold">{t("agents.connection")}</legend>
        <p className="text-xs text-muted">
          {text ? t("agents.connectionTextHint") : t("agents.connectionVoiceHint")}
        </p>
        {text ? null : protocolField}
        {baseUrlField}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("agents.field.channelId")}
            hint={text ? t("agents.field.channelIdHint") : undefined}
            error={fieldError("channelId")}
          >
            {(control) => <Input mono autoComplete="off" spellCheck={false} {...control} {...registerField("channelId")} />}
          </Field>
          {text ? null : (
            <Field label={t("agents.field.userId")} error={fieldError("userId")}>
              {(control) => <Input mono autoComplete="off" spellCheck={false} {...control} {...registerField("userId")} />}
            </Field>
          )}
        </div>
        {text ? textModeField : null}
        {text ? authField : null}
        {originField(t("agents.field.origin"))}
      </fieldset>

      {langfuseField}
      {errorAlert}

      <div className="flex flex-wrap justify-end gap-3">
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" loading={pending}>
          {pending ? t("editor.saving") : editing ? t("agents.saveChanges") : t("agents.create")}
        </Button>
      </div>
    </form>
  );
}

type SectionCardProps = { title: string; subtitle: string; badge?: ReactNode; status?: ReactNode; children: ReactNode };

/** One of the detail's cards: a titled region with an optional badge and status pill. */
function SectionCard({ title, subtitle, badge, status, children }: SectionCardProps) {
  const headingId = useId();
  return (
    <Card aria-labelledby={headingId} className="gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <h2 id={headingId} className="text-[15px] font-semibold">
              {title}
            </h2>
            {badge}
          </span>
          <p className="text-xs text-dim">{subtitle}</p>
        </div>
        {status}
      </div>
      {children}
    </Card>
  );
}

const PARAM_CELL = "border-b border-line-soft px-2.5 py-2.5 align-top";

/** The values every run sends: the fixed ones (channel, and user for voice); the thread ID is new per run. */
function ParamsTable({ fixed }: { fixed: { key: string; input: ReactNode }[] }) {
  const t = useT();
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-xs font-medium text-muted">
        {t("agents.params")}
      </span>
      <div className="overflow-x-auto">
        <table aria-labelledby={labelId} className="w-full min-w-[520px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-dim">
              <th scope="col" className="border-b border-line px-2.5 py-2 font-medium">{t("scenarios.key")}</th>
              <th scope="col" className="border-b border-line px-2.5 py-2 font-medium">{t("scenarios.value")}</th>
              <th scope="col" className="border-b border-line px-2.5 py-2 font-medium">{t("agents.perRun")}</th>
            </tr>
          </thead>
          <tbody>
            {fixed.map(({ key, input }) => (
              <tr key={key}>
                <th scope="row" className={`${PARAM_CELL} pt-5 text-left font-mono text-xs font-normal`}>
                  {key}
                </th>
                <td className={PARAM_CELL}>{input}</td>
                <td className={`${PARAM_CELL} pt-4`}>
                  <Badge tone="muted">{t("agents.fixed")}</Badge>
                </td>
              </tr>
            ))}
            <tr>
              <th scope="row" className={`${PARAM_CELL} text-left font-mono text-xs font-normal`}>threadId</th>
              <td className={`${PARAM_CELL} font-mono text-xs text-body`}>{t("agents.newUuid")}</td>
              <td className={PARAM_CELL}>
                <Badge tone="evaluator">{t("agents.generated")}</Badge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
