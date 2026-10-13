"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useForm, useWatch, type Path } from "react-hook-form";
import type { Agent } from "@/features/agents/types";
import type { FieldErrors } from "@/lib/api";
import { useUnsavedChangesGuard } from "@/lib/navigation/unsaved-changes";
import { PageHeader } from "@/features/shell/PageHeader";
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
  type FilterChipOption,
} from "@/ui";
import { CriteriaEditor, WeightsStatus } from "./CriteriaEditor";
import { errorAt, formPath } from "./editor-form";
import { FactsEditor } from "./FactsEditor";
import { InterruptionsEditor } from "./InterruptionsEditor";
import {
  EVALUATOR_MODE_LABELS,
  REALTIME_MODEL_LABELS,
  HANG_UP_LABELS,
  initialValues,
  scenarioFormSchemaFor,
  TEMPERAMENT_LABELS,
  type ScenarioFormValues,
} from "./form-schema";
import {
  EVALUATOR_MODES,
  HANG_UP_RULES,
  REALTIME_MODELS,
  REALTIME_VOICES,
  TEMPERAMENTS,
  type EvaluatorMode,
  type Scenario,
  type Temperament,
} from "./types";

const NO_SERVER_ERRORS: FieldErrors = {};
const TEMPERAMENT_OPTIONS: FilterChipOption<Temperament>[] = TEMPERAMENTS.map((value) => ({
  value,
  label: TEMPERAMENT_LABELS[value],
}));

export type ConnectionOption = { id: string; name: string };

type ScenarioEditorProps = {
  /** Present when editing. */
  scenario?: Scenario;
  agents: Agent[];
  /** Connections that can voice the evaluator (OpenAI, Azure OpenAI). */
  ttsOptions: ConnectionOption[];
  /** Connections with a chat model that can decide the caller's turns. */
  evaluatorOptions: ConnectionOption[];
  /** Resolves with the stored scenario when saved, `undefined` when the save failed. */
  onSubmit: (values: ScenarioFormValues) => Promise<Scenario | undefined>;
  onCancel: () => void;
  pending: boolean;
  /** Form-level error from the last save. */
  error?: string;
  /** Per-field errors from the server, keyed by API location (`facts.2.key`); a new object per failure. */
  serverFieldErrors?: FieldErrors;
  /** Page title and its breadcrumb eyebrow; the header also carries the save state and actions. */
  title: string;
  eyebrow?: ReactNode;
  /** Duplicates the saved scenario; absent while creating. */
  onDuplicate?: () => void;
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
  eyebrow,
  onDuplicate,
  duplicating = false,
  banner,
  library,
  launch,
}: ScenarioEditorProps) {
  const editing = scenario !== undefined;
  const form = useForm<ScenarioFormValues>({
    // The chosen agent's kind decides what is required (a text agent needs the evaluator model).
    resolver: (values, context, options) => {
      const kind = agents.find((item) => item.id === values.agentId)?.kind ?? "voice";
      return zodResolver(scenarioFormSchemaFor(kind))(values, context, options);
    },
    defaultValues: initialValues(scenario, agents[0]?.id),
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
    trigger,
    formState: { errors, isDirty },
  } = form;
  const formRef = useRef<HTMLFormElement>(null);
  // Set by a failed save; the next render that shows an error moves focus to it.
  const focusFirstError = useRef(false);
  const [saved, setSaved] = useState(false);
  useUnsavedChangesGuard(isDirty);

  // After a failed save, focus the first field (in page order) that shows an error.
  useEffect(() => {
    if (!focusFirstError.current) return;
    const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-error-focus]');
    if (!first) return;
    focusFirstError.current = false;
    first.focus();
  });

  // Server field errors live in the form state, so editing a field clears its error.
  const otherServerErrors: string[] = [];
  for (const [apiPath, message] of Object.entries(serverFieldErrors)) {
    if (!formPath(apiPath)) otherServerErrors.push(message);
  }
  useEffect(() => {
    for (const [apiPath, message] of Object.entries(serverFieldErrors)) {
      const path = formPath(apiPath);
      if (!path) continue;
      setError(path as Path<ScenarioFormValues>, { type: "server", message });
      focusFirstError.current = true;
    }
  }, [serverFieldErrors, setError]);

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

  const agentId = useWatch({ control, name: "agentId" });
  const evaluatorMode = useWatch({ control, name: "evaluatorMode" });
  const agent = agents.find((item) => item.id === agentId);
  // A text agent chats: no voice, no barge-ins, and the evaluator model writes every message.
  const text = agent?.kind === "text";
  // Text agents have no interruptions card, so the evaluator card moves up.
  const evaluatorNumber = text ? 6 : 7;
  const linkedTts = scenario?.ttsConnectionId;
  const voiceOptions =
    linkedTts && !ttsOptions.some((option) => option.id === linkedTts)
      ? [...ttsOptions, { id: linkedTts, name: "Current connection" }]
      : ttsOptions;
  const linkedEvaluator = scenario?.evaluatorConnectionId;
  const chatOptions =
    linkedEvaluator && !evaluatorOptions.some((option) => option.id === linkedEvaluator)
      ? [...evaluatorOptions, { id: linkedEvaluator, name: "Current connection" }]
      : evaluatorOptions;

  async function onValid(values: ScenarioFormValues) {
    setSaved(false);
    const stored = await onSubmit(values);
    if (stored) {
      reset(initialValues(stored));
      setSaved(true);
    }
  }

  function onInvalid() {
    focusFirstError.current = true;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => handleSubmit(onValid, onInvalid)(event);

  const status = isDirty ? "Unsaved changes" : saved ? "Saved" : "";

  const formId = "scenario-form";
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
        eyebrow={eyebrow}
        actions={
          <>
            <p role="status" className="text-xs text-dim">
              {status}
            </p>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            {onDuplicate ? (
              <Button variant="secondary" loading={duplicating} onClick={onDuplicate}>
                {duplicating ? "Duplicating…" : "Duplicate"}
              </Button>
            ) : null}
            <Button type="submit" form={formId} loading={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Create scenario"}
            </Button>
          </>
        }
      />
      {banner}
      <div className="grid items-start gap-5 min-[1340px]:grid-cols-[240px_minmax(0,1fr)_280px]">
        {library}
        <form
          ref={formRef}
          id={formId}
          noValidate
          aria-label="Scenario definition"
          onSubmit={submit}
          className="flex min-w-0 flex-col gap-4"
        >
          <Section
            id="scenario-target"
            title="1 · Target agent and context"
            actions={
              <Link href="/agents" className={cn("inline-flex min-h-9 items-center rounded text-[13px]", focusRing)}>
                Agent settings →
              </Link>
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name" error={fieldError("name")}>
                {(props) => <Input autoComplete="off" {...props} {...registerField("name")} />}
              </Field>
              <Field label="Tags" hint="Comma-separated, like booking, regression." error={fieldError("tags")}>
                {(props) => <Input autoComplete="off" {...props} {...registerField("tags")} />}
              </Field>
            </div>
            <Field label="Agent under test" error={fieldError("agentId")}>
              {(props) => (
                <Select {...props} {...registerField("agentId")}>
                  {agents.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <section aria-label="Agent context" className="flex flex-col gap-2 rounded-[10px] border border-line bg-field p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-muted">
                  {agent ? `Agent context · shared by all scenarios of ${agent.name}` : "Agent context"}
                </p>
                <Badge tone="agent" className="text-[11px]">
                  Inherited
                </Badge>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-body">
                {agent?.context || "This agent has no shared context yet."}
              </p>
            </section>
            <Field
              label="Scenario-specific context"
              hint="Added on top of the agent's shared context for this scenario only."
              error={fieldError("context")}
            >
              {(props) => <Textarea rows={3} {...props} {...registerField("context")} />}
            </Field>
          </Section>

          <Section id="scenario-persona" title="2 · Persona the evaluator plays">
            <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))]">
              <Field label="Persona name" error={fieldError("persona.name")}>
                {(props) => <Input autoComplete="off" {...props} {...registerField("persona.name")} />}
              </Field>
              <Field label="Locale" hint="Language tag, like es-MX or en-US." error={fieldError("persona.locale")}>
                {(props) => <Input mono autoComplete="off" spellCheck={false} {...props} {...registerField("persona.locale")} />}
              </Field>
              {text ? null : (
                <Field
                  label="Voice override (optional)"
                  hint={
                    evaluatorMode === "realtime"
                      ? `A realtime voice: ${REALTIME_VOICES.join(", ")}.`
                      : "A voice ID of the voice connection, like coral."
                  }
                  error={fieldError("voiceOverride")}
                >
                  {(props) => <Input mono autoComplete="off" spellCheck={false} {...props} {...registerField("voiceOverride")} />}
                </Field>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <span aria-hidden="true" className="text-xs font-medium text-muted">
                Temperament
              </span>
              <FilterChips
                label="Temperament"
                tone="evaluator"
                size="md"
                options={TEMPERAMENT_OPTIONS}
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
            <Field label="Persona notes" hint="Habits and quirks, like interrupting." error={fieldError("persona.notes")}>
              {(props) => <Textarea rows={2} {...props} {...registerField("persona.notes")} />}
            </Field>
          </Section>

          <Section id="scenario-goal" title="3 · Goal and instructions">
            <Field label="Goal" hint="What the caller wants to achieve; the judge checks it." error={fieldError("goal")}>
              {(props) => <Textarea rows={3} {...props} {...registerField("goal")} />}
            </Field>
            <Field label="How to behave" hint="How the caller talks and reacts." error={fieldError("instructions")}>
              {(props) => <Textarea rows={3} {...props} {...registerField("instructions")} />}
            </Field>
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted">Facts the caller knows (only revealed when asked)</h3>
              <FactsEditor control={control} registerField={registerField} fieldError={fieldError} />
            </div>
          </Section>

          <Section
            id="scenario-criteria"
            title="4 · Success criteria for the judge"
            actions={<WeightsStatus control={control} />}
          >
            <CriteriaEditor control={control} registerField={registerField} fieldError={fieldError} />
          </Section>

          <Section id="scenario-end" title={`5 · When the ${text ? "conversation" : "call"} ends`}>
            <div className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))]">
              <Field label="Max duration (s)" error={fieldError("endConditions.maxDurationS")}>
                {(props) => (
                  <Input mono type="number" inputMode="numeric" min={30} max={1800} {...props} {...registerField("endConditions.maxDurationS")} />
                )}
              </Field>
              {text ? (
                <Field
                  label="Max turns"
                  hint="Messages the evaluator sends before it stops, 1–100."
                  error={fieldError("endConditions.maxTurns")}
                >
                  {(props) => (
                    <Input mono type="number" inputMode="numeric" min={1} max={100} {...props} {...registerField("endConditions.maxTurns")} />
                  )}
                </Field>
              ) : (
                <Field label="Max silence (s)" error={fieldError("endConditions.maxSilenceS")}>
                  {(props) => (
                    <Input mono type="number" inputMode="numeric" min={5} max={120} {...props} {...registerField("endConditions.maxSilenceS")} />
                  )}
                </Field>
              )}
              <Field label="Hang up when" error={fieldError("endConditions.hangUpWhen")}>
                {(props) => (
                  <Select {...props} {...registerField("endConditions.hangUpWhen")}>
                    {HANG_UP_RULES.map((rule) => (
                      <option key={rule} value={rule}>
                        {HANG_UP_LABELS[rule]}
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
              title="6 · Interruptions"
              description="The caller cuts the agent off mid-reply, like a person barging in. Agent replies count from 1."
            >
              <InterruptionsEditor control={control} registerField={registerField} fieldError={fieldError} />
            </Section>
          )}

          {text ? (
            <Section
              id="scenario-evaluator"
              title={`${evaluatorNumber} · Evaluator`}
              description="A chat model plays the user and writes every message to the agent."
            >
              <Field
                label="Evaluator model connection"
                hint="Required for text agents: its chat model writes the user's messages. Azure OpenAI connections need a chat deployment."
                error={fieldError("evaluatorConnectionId")}
              >
                {(props) => (
                  <Select {...props} {...registerField("evaluatorConnectionId")}>
                    <option value="">Choose a connection</option>
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
              title={`${evaluatorNumber} · Evaluator`}
              description="How the caller hears the agent and speaks back."
            >
              <RadioCardGroup label="Evaluator">
                {EVALUATOR_MODES.map((mode) => (
                  <RadioCard
                    key={mode}
                    name="evaluatorMode"
                    value={mode}
                    checked={evaluatorMode === mode}
                    onChange={setEvaluatorMode}
                    title={EVALUATOR_MODE_LABELS[mode].label}
                    description={EVALUATOR_MODE_LABELS[mode].description}
                  />
                ))}
              </RadioCardGroup>
              {evaluatorMode === "realtime" ? (
                <div className="flex flex-col gap-2">
                  <span aria-hidden="true" className="text-xs font-medium text-muted">
                    Realtime model
                  </span>
                  <RadioCardGroup label="Realtime model">
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
                        description={REALTIME_MODEL_LABELS[model]}
                      />
                    ))}
                  </RadioCardGroup>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <Field
                  label="Evaluator voice (TTS connection)"
                  hint={
                    evaluatorMode === "realtime"
                      ? "The realtime session uses this OpenAI or Azure OpenAI connection. None uses the platform's default."
                      : "None uses the platform's default evaluator voice."
                  }
                  error={fieldError("ttsConnectionId")}
                >
                  {(props) => (
                    <Select {...props} {...registerField("ttsConnectionId")}>
                      <option value="">None</option>
                      {voiceOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field
                  label="Evaluator model connection"
                  hint="Chat model that decides what the caller says. Azure OpenAI connections need a chat deployment."
                  error={fieldError("evaluatorConnectionId")}
                >
                  {(props) => (
                    <Select {...props} {...registerField("evaluatorConnectionId")}>
                      <option value="">Same as voice connection</option>
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
