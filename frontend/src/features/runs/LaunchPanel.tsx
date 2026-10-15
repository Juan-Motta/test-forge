"use client";

import { useRef, useState, type FormEvent } from "react";
import type { AgentKind } from "@/features/agents/types";
import { errorMessage } from "@/lib/api";
import { useT, type Translator } from "@/lib/i18n";
import { Alert, Button, Field, Input, cn } from "@/ui";
import {
  DEFAULT_DRAFT,
  MAX_CONCURRENCY,
  MAX_LABEL_LENGTH,
  MAX_REPETITIONS,
  estimatedMinutes,
  notRunnableReasons,
  plannedRuns,
  toLaunchInput,
  type LaunchDraft,
  type LaunchErrors,
} from "./launch";
import { useLaunchRuns } from "./queries";
import type { BatchDetail } from "./types";

/**
 * A saved scenario to launch; `maxDurationS` feeds the wall-time estimate and `kind` (its agent's)
 * names what each run is: a call (voice) or a conversation (text). Text runs need no voice connection.
 */
export type LaunchScenario = { id: string; name: string; maxDurationS?: number; kind?: AgentKind };

/** What one run is called: a call, a conversation, or a run when the batch mixes both. */
function runNoun(scenarios: LaunchScenario[]): "call" | "conversation" | "run" {
  const text = scenarios.filter((scenario) => scenario.kind === "text").length;
  if (text === 0) return "call";
  return text === scenarios.length ? "conversation" : "run";
}

function launchLabel(t: Translator, busy: boolean, planned: number | null): string {
  if (busy) return t("launch.launching");
  return planned === null ? t("launch.launchRuns") : t.plural("launch.launchCount", planned);
}

type LaunchPanelProps = {
  /** Saved scenarios to launch, in order. */
  scenarios: LaunchScenario[];
  onLaunched: (batch: BatchDetail) => void;
  /** Shows a Cancel button (a dialog host); disabled while a launch is in flight. */
  onCancel?: () => void;
  /** Told synchronously when a launch starts and settles, so a host can refuse to close meanwhile. */
  onBusyChange?: (busy: boolean) => void;
};

/**
 * The launch form shared by the library's dialog and the editor's rail: every scenario ×
 * "runs each", at most "in parallel" at a time. Each run is a real, paid call.
 */
export function LaunchPanel({ scenarios, onLaunched, onCancel, onBusyChange }: LaunchPanelProps) {
  const t = useT();
  const launch = useLaunchRuns();
  const [draft, setDraft] = useState<LaunchDraft>(DEFAULT_DRAFT);
  const [errors, setErrors] = useState<LaunchErrors>({});
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const sending = useRef(false);
  const busy = launch.isPending;

  const planned = plannedRuns(scenarios.length, draft);
  const minutes = estimatedMinutes(scenarios, draft);
  const refused = launch.isError ? notRunnableReasons(t, launch.error, scenarios) : [];
  const noun = runNoun(scenarios);

  function set(field: keyof LaunchDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const result = toLaunchInput(
      t,
      scenarios.map((scenario) => scenario.id),
      draft,
    );
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    sending.current = true;
    onBusyChange?.(true);
    launch.mutate(result.input, {
      onSuccess: (batch) => onLaunched(batch),
      onSettled: () => {
        sending.current = false;
        onBusyChange?.(false);
      },
    });
  }

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
      {scenarios.length === 1 ? (
        <div role="radiogroup" aria-label={t("launch.whatToRun")} className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-2.5 rounded-lg border border-evaluator bg-selected px-3 text-[13px]">
            <input type="radio" name="launch-scope" checked readOnly className="accent-evaluator" />
            {t("launch.thisScenario")}
          </label>
        </div>
      ) : (
        <ul aria-label={t("nav.scenarios")} className="flex flex-col gap-1 text-sm text-muted">
          {scenarios.map((scenario) => (
            <li key={scenario.id}>{scenario.name}</li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("launch.runsEach")} hint={t("launch.runsEachHint", { max: MAX_REPETITIONS })} error={errors.repetitions}>
          {(props) => (
            <Input
              {...props}
              mono
              inputMode="numeric"
              value={draft.repetitions}
              onChange={(event) => set("repetitions", event.target.value)}
            />
          )}
        </Field>
        <Field label={t("launch.inParallel")} hint={t("launch.inParallelHint", { max: MAX_CONCURRENCY })} error={errors.concurrency}>
          {(props) => (
            <Input
              {...props}
              mono
              inputMode="numeric"
              value={draft.concurrency}
              onChange={(event) => set("concurrency", event.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label={t("launch.label")} hint={t("launch.labelHint")} error={errors.label}>
        {(props) => (
          <Input
            {...props}
            maxLength={MAX_LABEL_LENGTH + 20}
            value={draft.label}
            onChange={(event) => set("label", event.target.value)}
          />
        )}
      </Field>
      <label className="flex items-center gap-2.5 text-[13px] text-body">
        <input type="checkbox" checked disabled readOnly className="size-[18px] accent-evaluator" />
        {t(`launch.autoJudge.${noun}`)}
      </label>
      <div className="flex justify-between gap-3 border-t border-line pt-3 text-xs text-muted">
        <span>{planned === null ? "" : t.plural(`launch.count.${noun}`, planned)}</span>
        {minutes === null ? null : <span>{t("launch.wallTime", { minutes })}</span>}
      </div>
      {launch.isError ? (
        refused.length > 0 ? (
          <Alert title={t("launch.someCannotRun")}>
            <ul className="flex flex-col gap-1">
              {refused.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </Alert>
        ) : (
          <Alert title={t("launch.failed")}>{errorMessage(launch.error)}</Alert>
        )
      ) : null}
      <div className={cn("flex flex-wrap gap-3", onCancel ? "justify-end" : "flex-col")}>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button type="submit" loading={busy} icon={<PlayIcon />} className={onCancel ? undefined : "min-h-12 text-[15px]"}>
          {launchLabel(t, busy, planned)}
        </Button>
      </div>
    </form>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 5v14l11-7z" />
    </svg>
  );
}
