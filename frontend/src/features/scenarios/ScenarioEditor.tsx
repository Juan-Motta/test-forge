"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useForm, useWatch, type Path } from "react-hook-form";
import type { Agent, AgentKind } from "@/features/agents/types";
import type { FieldErrors } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useUnsavedChangesGuard } from "@/lib/navigation/unsaved-changes";
import type { Crumb } from "@/features/shell/Breadcrumbs";
import { ConfigImportPanel } from "@/features/transfer/ConfigImportPanel";
import { ExportDialog } from "@/features/transfer/ExportDialog";
import { transferFileName } from "@/features/transfer/transfer";
import { PageHeader } from "@/features/shell/PageHeader";
import { OPENAI_VOICES, type KindVoices } from "@/features/connections/voices";
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  FilterChips,
  Input,
  RadioCard,
  RadioCardGroup,
  Select,
  Textarea,
  cn,
  focusRing,
} from "@/ui";
import { localeChoices, voiceChoices } from "./choices";
import type { ScenarioImport } from "./transfer";
import { CriteriaEditor, WeightsStatus } from "./CriteriaEditor";
import { errorAt, formPath } from "./editor-form";
import { FactsEditor } from "./FactsEditor";
import { InterruptionsEditor } from "./InterruptionsEditor";
import { initialValues, isHiddenFor, scenarioFormSchemaFor, temperamentLabel, type ScenarioFormValues } from "./form-schema";
import {
  EVALUATOR_MODES,
  HANG_UP_RULES,
  REALTIME_MODELS,
  REALTIME_VOICES,
  TEMPERAMENTS,
  type EvaluatorMode,
  type RealtimeModel,
  type Scenario,
} from "./types";

const NO_SERVER_ERRORS: FieldErrors = {};
const REALTIME_MODEL_HINTS = {
  "gpt-realtime-2.1-mini": "scenarios.realtimeMiniHint",
  "gpt-realtime-2.1": "scenarios.realtimeFullHint",
} as const satisfies Record<RealtimeModel, string>;

/** `voices`: what the connection can voice the evaluator with; unknown for a linked connection the list no longer has. */
export type ConnectionOption = { id: string; name: string; voices?: KindVoices };

type ScenarioEditorProps = {
  /** Present when editing. */
  scenario?: Scenario;
  agents: Agent[];
  /** Connections that can voice the evaluator (OpenAI, Azure OpenAI). */
  ttsOptions: ConnectionOption[];
  /** Connections with a chat model that can decide the caller's turns. */
  evaluatorOptions: ConnectionOption[];
  /** Resolves with the stored scenario when saved, `undefined` when the save failed. */
  /** `kind`: the chosen agent's kind, which decides what the payload carries. */
  onSubmit: (values: ScenarioFormValues, kind: AgentKind) => Promise<Scenario | undefined>;
  onCancel: () => void;
  pending: boolean;
  /** Form-level error from the last save. */
  error?: string;
  /** Per-field errors from the server, keyed by API location (`facts.2.key`); a new object per failure. */
  serverFieldErrors?: FieldErrors;
  /** Page title and its breadcrumbs; the header also carries the save state and actions. */
  title: string;
  breadcrumbs?: readonly Crumb[];
  /** Duplicates the saved scenario; absent while creating. */
  onDuplicate?: () => void;
  /** Asks to delete the saved scenario; absent while creating. */
  onDelete?: () => void;
  /** The agent a new scenario starts with; the first agent when absent. */
  defaultAgentId?: string;
  /** The group a new scenario starts in; the agent's default group when absent. */
  defaultGroupId?: string;
  /** The groups a scenario can live in. */
  groups: { id: string; name: string }[];
  /** The saved scenario as text (Export); absent while creating. */
  exportText?: string;
  /** Prefills a new scenario from an exported one (Import); absent while editing. */
  importConfig?: (text: string) => ScenarioImport;
  duplicating?: boolean;
  /** Shown under the header (e.g. a failed duplicate). */
  banner?: ReactNode;
  /** Left rail (the scenario library) and right rail (launch). */
  library?: ReactNode;
  launch?: ReactNode;
};

/**
 * Presentational scenario editor (create and edit): header with the save state, the library and
 * launch rails around numbered cards; validates locally and reports values.
 */
export function ScenarioEditor({
  scenario,
  agents,
  ttsOptions,
  evaluatorOptions,
  onSubmit,
  onCancel,
  pending,
  error,
  serverFieldErrors = NO_SERVER_ERRORS,
  title,
  breadcrumbs,
  onDuplicate,
  exportText,
  importConfig,
  onDelete,
  defaultAgentId,
  defaultGroupId,
  groups,
  duplicating = false,
  banner,
  library,
  launch,
}: ScenarioEditorProps) {
  const t = useT();
  const editing = scenario !== undefined;
  const form = useForm<ScenarioFormValues>({
    // The chosen agent's kind decides what is required (a text agent needs the evaluator model).
    resolver: (values, context, options) => {
      const kind = agents.find((item) => item.id === values.agentId)?.kind ?? "voice";
      const connection = ttsOptions.find((option) => option.id === values.ttsConnectionId);
      const voiceConnection = connection?.voices ? { name: connection.name, voices: connection.voices.pipeline } : undefined;
      return zodResolver(scenarioFormSchemaFor(t, kind, voiceConnection))(values, context, options);
    },
    defaultValues: initialValues(scenario, defaultAgentId ?? agents[0]?.id, defaultGroupId),
    shouldFocusError: false,
  });
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    setValue,
    getValues,
    trigger,
    formState: { errors, isDirty },
  } = form;
  const formRef = useRef<HTMLFormElement>(null);
  // Set by a failed save; the next render that shows an error moves focus to it.
  const focusFirstError = useRef(false);
  const [saved, setSaved] = useState(false);
  useUnsavedChangesGuard(isDirty, t("common.leaveUnsaved"));

  // After a failed save, focus the first field (in page order) that shows an error.
  useEffect(() => {
    if (!focusFirstError.current) return;
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-error-focus]');
    if (!first) return;
    focusFirstError.current = false;
    first.focus();
  });

  const agentId = useWatch({ control, name: "agentId" });
  const evaluatorMode = useWatch({ control, name: "evaluatorMode" });
  const locale = useWatch({ control, name: "persona.locale" });
  const voice = useWatch({ control, name: "voiceOverride" });
  const ttsConnectionId = useWatch({ control, name: "ttsConnectionId" });
  const selectedAgentId = useWatch({ control, name: "agentId" });
  // The stored group stays selectable while the list loads (or if it failed).
  const groupOptions =
    scenario && !groups.some((item) => item.id === scenario.groupId) ? [...groups, scenario.group] : groups;
  // The voices of the chosen voice connection (its kind and TTS model); OpenAI's when none is chosen.
  const kindVoices = ttsOptions.find((option) => option.id === ttsConnectionId)?.voices ?? OPENAI_VOICES;
  // The voice may not suit the newly chosen connection (or the mode it opened with): re-check it.
  useEffect(() => {
    if (getValues("voiceOverride").trim()) void trigger("voiceOverride");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the connection changes
  }, [ttsConnectionId]);
  const agent = agents.find((item) => item.id === agentId);
  // A text agent chats: no voice, no barge-ins, and the evaluator model writes every message.
  const text = agent?.kind === "text";
  const kind: AgentKind = agent?.kind ?? "voice";

  // Server field errors live in the form state, so editing a field clears its error. Errors on
  // fields this agent's editor hides (voice-only settings of a text agent) show in the form alert.
  const otherServerErrors: string[] = [];
  for (const [apiPath, message] of Object.entries(serverFieldErrors)) {
    if (!formPath(apiPath) || isHiddenFor(kind, apiPath)) otherServerErrors.push(message);
  }
  useEffect(() => {
    for (const [apiPath, message] of Object.entries(serverFieldErrors)) {
      const path = formPath(apiPath);
      if (!path || isHiddenFor(kind, apiPath)) continue;
      setError(path as Path<ScenarioFormValues>, { type: "server", message });
      focusFirstError.current = true;
    }
  }, [serverFieldErrors, setError, kind]);

  const fieldError = (path: string) => errorAt(errors, path);
  const registerField = (path: Path<ScenarioFormValues>) =>
    register(path, {
      onChange: () => {
        clearErrors(path);
        if (path.startsWith("facts.")) clearErrors("facts.root" as Path<ScenarioFormValues>);
        if (path.startsWith("criteria.")) clearErrors("criteria.root" as Path<ScenarioFormValues>);
        if (path.startsWith("interruptions.")) clearErrors("interruptions.root" as Path<ScenarioFormValues>);
      },
    });

  // Text agents have no interruptions card, so the evaluator card moves up.
  const evaluatorNumber = text ? 6 : 7;
  const linkedTts = scenario?.ttsConnectionId;
  const voiceOptions =
    linkedTts && !ttsOptions.some((option) => option.id === linkedTts)
      ? [...ttsOptions, { id: linkedTts, name: t("scenarios.currentConnection") }]
      : ttsOptions;
  const linkedEvaluator = scenario?.evaluatorConnectionId;
  const chatOptions =
    linkedEvaluator && !evaluatorOptions.some((option) => option.id === linkedEvaluator)
      ? [...evaluatorOptions, { id: linkedEvaluator, name: t("scenarios.currentConnection") }]
      : evaluatorOptions;

  async function onValid(values: ScenarioFormValues) {
    setSaved(false);
    const stored = await onSubmit(values, kind);
    if (stored) {
      reset(initialValues(stored));
      setSaved(true);
    }
  }

  function onInvalid() {
    focusFirstError.current = true;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => handleSubmit(onValid, onInvalid)(event);

  const status = isDirty ? t("editor.unsaved") : saved ? t("editor.saved") : "";

  const formId = "scenario-form";
  const importPanelId = useId();
  const importToggleId = useId();
  // The Scenarios page's Import links here with #import. The editor mounts only once its data
  // has loaded in the browser, so reading the hash here never differs from a server render.
  const [importOpen, setImportOpen] = useState(
    () => importConfig !== undefined && typeof window !== "undefined" && window.location.hash === "#import",
  );
  const [importNotes, setImportNotes] = useState<string[]>();
  const [exportOpen, setExportOpen] = useState(false);

  function closeImport() {
    setImportOpen(false);
    document.getElementById(importToggleId)?.focus();
  }

  // The whole form takes the imported scenario, as unsaved edits; nothing is stored until Create.
  function applyImport(text: string): string | undefined {
    const result = importConfig?.(text);
    if (!result) return undefined;
    if (!result.ok) return result.error;
    reset(result.values, { keepDefaultValues: true });
    setImportNotes([t("transfer.filled"), ...result.notes]);
    closeImport();
    return undefined;
  }
  const temperament = useWatch({ control, name: "persona.temperament" });
  const realtimeModel = useWatch({ control, name: "realtimeModel" });
  const setEvaluatorMode = (mode: EvaluatorMode) => {
    setValue("evaluatorMode", mode, { shouldDirty: true });
    void trigger("voiceOverride");
  };

  return (
    <div className="flex flex-col gap-[22px]">
      <PageHeader
        title={title}
        breadcrumbs={breadcrumbs}
        actions={
          <>
            <p role="status" className="text-xs text-dim">
              {status}
            </p>
            <Button variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            {importConfig ? (
              <Button
                id={importToggleId}
                variant="secondary"
                aria-expanded={importOpen}
                aria-controls={importOpen ? importPanelId : undefined}
                onClick={() => (importOpen ? closeImport() : (setImportNotes(undefined), setImportOpen(true)))}
              >
                {t("transfer.import")}
              </Button>
            ) : null}
            {exportText ? (
              <Button variant="secondary" onClick={() => setExportOpen(true)}>
                {t("transfer.export")}
              </Button>
            ) : null}
            {onDelete && scenario ? (
              <Button variant="ghost" aria-label={t("scenarios.deleteNamed", { name: scenario.name })} onClick={onDelete}>
                {t("common.delete")}
              </Button>
            ) : null}
            {onDuplicate ? (
              <Button variant="secondary" loading={duplicating} onClick={onDuplicate}>
                {duplicating ? t("editor.duplicating") : t("editor.duplicate")}
              </Button>
            ) : null}
            <Button type="submit" form={formId} loading={pending}>
              {pending ? t("editor.saving") : editing ? t("editor.save") : t("scenarios.create")}
            </Button>
          </>
        }
      />
      {banner}
      {importOpen ? (
        <ConfigImportPanel id={importPanelId} label={t("transfer.importScenario")} onImport={applyImport} onCancel={closeImport} />
      ) : null}
      {importNotes ? (
        <Alert tone="info">
          {importNotes.map((note) => (
            <span key={note} className="block">
              {note}
            </span>
          ))}
        </Alert>
      ) : null}
      {exportText ? (
        <ExportDialog
          open={exportOpen}
          title={t("transfer.exportScenario", { name: scenario?.name ?? "" })}
          text={exportText}
          fileName={transferFileName("scenario", scenario?.name ?? "")}
          onClose={() => setExportOpen(false)}
        />
      ) : null}
      <div className="grid items-start gap-5 min-[1340px]:grid-cols-[240px_minmax(0,1fr)_280px]">
        {library}
        <form
          ref={formRef}
          id={formId}
          noValidate
          aria-label={t("scenarios.definition")}
          onSubmit={submit}
          className="flex min-w-0 flex-col gap-4"
        >
          <Section
            id="scenario-target"
            title={t("scenarios.section.target")}
            actions={
              <Link href="/agents" className={cn("inline-flex min-h-9 items-center rounded text-[13px]", focusRing)}>
                {`${t("scenarios.agentSettings")} →`}
              </Link>
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t("scenarios.field.name")} error={fieldError("name")}>
                {(props) => <Input autoComplete="off" {...props} {...registerField("name")} />}
              </Field>
              <Field label={t("scenarios.field.tags")} hint={t("scenarios.field.tagsHint")} error={fieldError("tags")}>
                {(props) => <Input autoComplete="off" {...props} {...registerField("tags")} />}
              </Field>
            </div>
            <Field label={t("scenarios.field.agent")} error={fieldError("agentId")}>
              {(props) => (
                <Select {...props} {...registerField("agentId")}>
                  {selectedAgentId ? null : (
                    <option value="" disabled>
                      {t("scenarios.pickAgent")}
                    </option>
                  )}
                  {agents.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("scenarios.field.group")} hint={t("scenarios.field.groupHint")} error={fieldError("groupId")}>
              {(props) => (
                <Select {...props} {...registerField("groupId")}>
                  {editing ? null : <option value="">{t("scenarios.field.groupDefault")}</option>}
                  {groupOptions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <section aria-label={t("scenarios.agentContext")} className="flex flex-col gap-2 rounded-[10px] border border-line bg-field p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted">
                  {agent ? t("scenarios.agentContextOf", { agent: agent.name }) : t("scenarios.agentContext")}
                </p>
                <Badge tone="agent" className="text-[11px]">
                  {t("scenarios.inherited")}
                </Badge>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-body">
                {agent?.context || t("scenarios.noAgentContext")}
              </p>
            </section>
            <Field
              label={t("scenarios.field.context")}
              hint={t("scenarios.field.contextHint")}
              error={fieldError("context")}
            >
              {(props) => <Textarea rows={3} {...props} {...registerField("context")} />}
            </Field>
          </Section>

          <Section id="scenario-persona" title={t("scenarios.section.persona")}>
            <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))]">
              <Field label={t("scenarios.field.personaName")} error={fieldError("persona.name")}>
                {(props) => <Input autoComplete="off" {...props} {...registerField("persona.name")} />}
              </Field>
              <Field label={t("scenarios.field.locale")} hint={t("scenarios.field.localeHint")} error={fieldError("persona.locale")}>
                {(props) => (
                  <Select {...props} {...registerField("persona.locale")}>
                    {localeChoices(locale, t.locale).map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {text ? null : (
                <Field
                  label={t("scenarios.field.voice")}
                  hint={evaluatorMode === "realtime" ? t("scenarios.field.voiceRealtimeHint") : t("scenarios.field.voiceHint")}
                  error={fieldError("voiceOverride")}
                >
                  {(props) => (
                    <Select {...props} {...registerField("voiceOverride")}>
                      <option value="">{t("scenarios.field.voiceDefault")}</option>
                      {voiceChoices(kindVoices[evaluatorMode], voice).map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <span aria-hidden="true" className="text-xs font-medium text-muted">
                {t("scenarios.field.temperament")}
              </span>
              <FilterChips
                label={t("scenarios.field.temperament")}
                tone="evaluator"
                size="md"
                options={TEMPERAMENTS.map((value) => ({ value, label: temperamentLabel(t, value) }))}
                selected={[temperament]}
                onToggle={(value) => {
                  setValue("persona.temperament", value, { shouldDirty: true });
                  clearErrors("persona.temperament");
                }}
              />
              {fieldError("persona.temperament") ? (
                <p className="text-xs text-danger-fg">{fieldError("persona.temperament")}</p>
              ) : null}
            </div>
            <Field label={t("scenarios.field.notes")} hint={t("scenarios.field.notesHint")} error={fieldError("persona.notes")}>
              {(props) => <Textarea rows={2} {...props} {...registerField("persona.notes")} />}
            </Field>
          </Section>

          <Section id="scenario-goal" title={t("scenarios.section.goal")}>
            <Field label={t("scenarios.field.goal")} hint={t("scenarios.field.goalHint")} error={fieldError("goal")}>
              {(props) => <Textarea rows={3} {...props} {...registerField("goal")} />}
            </Field>
            <Field label={t("scenarios.field.instructions")} hint={t("scenarios.field.instructionsHint")} error={fieldError("instructions")}>
              {(props) => <Textarea rows={3} {...props} {...registerField("instructions")} />}
            </Field>
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted">{t("scenarios.facts")}</h3>
              <FactsEditor control={control} registerField={registerField} fieldError={fieldError} />
            </div>
          </Section>

          <Section
            id="scenario-criteria"
            title={t("scenarios.section.criteria")}
            actions={<WeightsStatus control={control} />}
          >
            <CriteriaEditor control={control} registerField={registerField} fieldError={fieldError} />
          </Section>

          <Section id="scenario-end" title={text ? t("scenarios.section.endText") : t("scenarios.section.endVoice")}>
            <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))]">
              <Field label={t("scenarios.field.maxDuration")} error={fieldError("endConditions.maxDurationS")}>
                {(props) => (
                  <Input mono type="number" inputMode="numeric" min={30} max={1800} {...props} {...registerField("endConditions.maxDurationS")} />
                )}
              </Field>
              {text ? (
                <Field
                  label={t("scenarios.field.maxTurns")}
                  hint={t("scenarios.field.maxTurnsHint")}
                  error={fieldError("endConditions.maxTurns")}
                >
                  {(props) => (
                    <Input mono type="number" inputMode="numeric" min={1} max={100} {...props} {...registerField("endConditions.maxTurns")} />
                  )}
                </Field>
              ) : (
                <Field label={t("scenarios.field.maxSilence")} error={fieldError("endConditions.maxSilenceS")}>
                  {(props) => (
                    <Input mono type="number" inputMode="numeric" min={5} max={120} {...props} {...registerField("endConditions.maxSilenceS")} />
                  )}
                </Field>
              )}
              <Field label={t("scenarios.field.hangUp")} error={fieldError("endConditions.hangUpWhen")}>
                {(props) => (
                  <Select {...props} {...registerField("endConditions.hangUpWhen")}>
                    {HANG_UP_RULES.map((rule) => (
                      <option key={rule} value={rule}>
                        {t(`scenarios.hangUp.${rule}`)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </Section>

          {text ? null : (
            <Section
              id="scenario-interruptions"
              title={t("scenarios.section.interruptions")}
              description={t("scenarios.section.interruptionsHint")}
            >
              <InterruptionsEditor control={control} registerField={registerField} fieldError={fieldError} />
            </Section>
          )}

          {text ? (
            <Section
              id="scenario-evaluator"
              title={t("scenarios.section.evaluator", { n: evaluatorNumber })}
              description={t("scenarios.section.evaluatorTextHint")}
            >
              <Field
                label={t("scenarios.field.evaluatorModel")}
                hint={t("scenarios.field.evaluatorModelTextHint")}
                error={fieldError("evaluatorConnectionId")}
              >
                {(props) => (
                  <Select {...props} {...registerField("evaluatorConnectionId")}>
                    <option value="">{t("scenarios.chooseConnection")}</option>
                    {chatOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </Section>
          ) : (
            <Section
              id="scenario-evaluator"
              title={t("scenarios.section.evaluator", { n: evaluatorNumber })}
              description={t("scenarios.section.evaluatorVoiceHint")}
            >
              <RadioCardGroup label={t("common.evaluator")}>
                {EVALUATOR_MODES.map((mode) => (
                  <RadioCard
                    key={mode}
                    name="evaluatorMode"
                    value={mode}
                    checked={evaluatorMode === mode}
                    onChange={setEvaluatorMode}
                    title={t(`scenarios.mode.${mode}`)}
                    description={t(`scenarios.mode.${mode}Hint`)}
                  />
                ))}
              </RadioCardGroup>
              {evaluatorMode === "realtime" ? (
                <div className="flex flex-col gap-2">
                  <span aria-hidden="true" className="text-xs font-medium text-muted">
                    {t("scenarios.realtimeModel")}
                  </span>
                  <RadioCardGroup label={t("scenarios.realtimeModel")}>
                    {REALTIME_MODELS.map((model) => (
                      <RadioCard
                        key={model}
                        name="realtimeModel"
                        value={model}
                        checked={realtimeModel === model}
                        onChange={(value) => {
                          setValue("realtimeModel", value, { shouldDirty: true });
                          clearErrors("realtimeModel");
                        }}
                        title={<span className="font-mono">{model}</span>}
                        description={t(REALTIME_MODEL_HINTS[model])}
                      />
                    ))}
                  </RadioCardGroup>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label={t("scenarios.field.tts")}
                  hint={evaluatorMode === "realtime" ? t("scenarios.field.ttsRealtimeHint") : t("scenarios.field.ttsHint")}
                  error={fieldError("ttsConnectionId")}
                >
                  {(props) => (
                    <Select {...props} {...registerField("ttsConnectionId")}>
                      <option value="">{t("scenarios.none")}</option>
                      {voiceOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  label={t("scenarios.field.evaluatorModel")}
                  hint={t("scenarios.field.evaluatorModelHint")}
                  error={fieldError("evaluatorConnectionId")}
                >
                  {(props) => (
                    <Select {...props} {...registerField("evaluatorConnectionId")}>
                      <option value="">{t("scenarios.sameAsVoice")}</option>
                      {chatOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            </Section>
          )}

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
        </form>
        {launch}
      </div>
    </div>
  );
}

/** A numbered card of the editor ("3 · Goal and instructions"), named by its heading. */
function Section({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card aria-labelledby={id} className="gap-3.5">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={id} className="text-[15px] font-semibold">
            {title}
          </h2>
          {actions}
        </div>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}
