"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useForm, useWatch, type Path } from "react-hook-form";
import type { Agent } from "@/features/agents/types";
import type { FieldErrors } from "@/lib/api";
import { useUnsavedChangesGuard } from "@/lib/navigation/unsaved-changes";
import { Alert, Button, Card, CardHeader, Field, Input, Select, Textarea, cn, focusRing } from "@/ui";
import { CriteriaEditor } from "./CriteriaEditor";
import { errorAt, formPath } from "./editor-form";
import { FactsEditor } from "./FactsEditor";
import {
  HANG_UP_LABELS,
  initialValues,
  scenarioFormSchema,
  TEMPERAMENT_LABELS,
  type ScenarioFormValues,
} from "./form-schema";
import { HANG_UP_RULES, TEMPERAMENTS, type Scenario } from "./types";

const NO_SERVER_ERRORS: FieldErrors = {};

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
};

/** Presentational scenario editor (create and edit): validates locally, reports values. */
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
}: ScenarioEditorProps) {
  const editing = scenario !== undefined;
  const form = useForm<ScenarioFormValues>({
    resolver: zodResolver(scenarioFormSchema),
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
      },
    });

  const agentId = useWatch({ control, name: "agentId" });
  const agent = agents.find((item) => item.id === agentId);
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

  return (
    <form ref={formRef} noValidate aria-label="Scenario" onSubmit={submit} className="flex flex-col gap-5">
      <Card aria-labelledby="scenario-basics">
        <CardHeader id="scenario-basics" title="Scenario" />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name" error={fieldError("name")}>
            {(props) => <Input autoComplete="off" {...props} {...registerField("name")} />}
          </Field>
          <Field label="Tags" hint="Comma-separated, like booking, regression." error={fieldError("tags")}>
            {(props) => <Input autoComplete="off" {...props} {...registerField("tags")} />}
          </Field>
        </div>
      </Card>

      <Section id="scenario-target" title="1 · Target agent and context">
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
        <section aria-label="Agent context" className="flex flex-col gap-2 rounded-lg border border-line bg-raised p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted">
              {agent ? `Shared by all scenarios of ${agent.name}` : "Shared agent context"}
            </p>
            <Link href="/agents" className={cn("rounded text-xs", focusRing)}>
              Agent settings →
            </Link>
          </div>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
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
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Persona name" error={fieldError("persona.name")}>
            {(props) => <Input autoComplete="off" {...props} {...registerField("persona.name")} />}
          </Field>
          <Field label="Locale" hint="Language tag, like es-MX or en-US." error={fieldError("persona.locale")}>
            {(props) => <Input mono autoComplete="off" spellCheck={false} {...props} {...registerField("persona.locale")} />}
          </Field>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-xs font-medium text-muted">Temperament</legend>
          <div className="flex flex-wrap gap-2">
            {TEMPERAMENTS.map((temperament) => (
              <label key={temperament} className="cursor-pointer">
                <input type="radio" value={temperament} className="peer sr-only" {...registerField("persona.temperament")} />
                <span
                  className={cn(
                    "inline-flex min-h-9 items-center rounded-full border border-line-strong px-3.5 text-sm text-muted",
                    "peer-checked:border-evaluator peer-checked:bg-evaluator/15 peer-checked:text-fg",
                    "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-evaluator",
                  )}
                >
                  {TEMPERAMENT_LABELS[temperament]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Persona notes" hint="Habits and quirks, like interrupting." error={fieldError("persona.notes")}>
          {(props) => <Textarea rows={2} {...props} {...registerField("persona.notes")} />}
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Evaluator voice (TTS connection)"
            hint="None uses the platform's default evaluator voice."
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
            label="Voice override (optional)"
            hint="A voice ID of that connection, like coral."
            error={fieldError("voiceOverride")}
          >
            {(props) => <Input mono autoComplete="off" spellCheck={false} {...props} {...registerField("voiceOverride")} />}
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

      <Section id="scenario-goal" title="3 · Goal and instructions">
        <Field label="Goal" hint="What the caller wants to achieve; the judge checks it." error={fieldError("goal")}>
          {(props) => <Textarea rows={3} {...props} {...registerField("goal")} />}
        </Field>
        <Field label="How to behave" hint="How the caller talks and reacts." error={fieldError("instructions")}>
          {(props) => <Textarea rows={3} {...props} {...registerField("instructions")} />}
        </Field>
      </Section>

      <Section id="scenario-facts" title="4 · Facts the caller knows" description="Revealed only when the agent asks.">
        <FactsEditor control={control} registerField={registerField} fieldError={fieldError} />
      </Section>

      <Section id="scenario-criteria" title="5 · Success criteria for the judge">
        <CriteriaEditor control={control} registerField={registerField} fieldError={fieldError} />
      </Section>

      <Section id="scenario-end" title="6 · When the call ends">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Max duration (s)" error={fieldError("endConditions.maxDurationS")}>
            {(props) => (
              <Input mono type="number" inputMode="numeric" min={30} max={1800} {...props} {...registerField("endConditions.maxDurationS")} />
            )}
          </Field>
          <Field label="Max silence (s)" error={fieldError("endConditions.maxSilenceS")}>
            {(props) => (
              <Input mono type="number" inputMode="numeric" min={5} max={120} {...props} {...registerField("endConditions.maxSilenceS")} />
            )}
          </Field>
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

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
        <p role="status" className="mr-auto text-sm text-muted">
          {status}
        </p>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {pending ? "Saving…" : editing ? "Save changes" : "Create scenario"}
        </Button>
      </div>
    </form>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <Card aria-labelledby={id}>
      <div className="flex flex-col gap-1">
        <CardHeader id={id} title={title} />
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}
