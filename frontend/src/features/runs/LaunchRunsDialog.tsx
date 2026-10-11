"use client";

import { useRef, useState, type FormEvent } from "react";
import { errorMessage } from "@/lib/api";
import { Alert, Button, Dialog, Field, Input } from "@/ui";
import {
  DEFAULT_DRAFT,
  MAX_CONCURRENCY,
  MAX_LABEL_LENGTH,
  MAX_REPETITIONS,
  notRunnableReasons,
  plannedRuns,
  toLaunchInput,
  type LaunchDraft,
  type LaunchErrors,
} from "./launch";
import { useLaunchRuns } from "./queries";
import type { BatchDetail } from "./types";

type LaunchRunsDialogProps = {
  open: boolean;
  /** Saved scenarios to launch, in order. */
  scenarios: { id: string; name: string }[];
  onClose: () => void;
  onLaunched: (batch: BatchDetail) => void;
};

/** Launches a batch: every scenario × repetitions, at most `concurrency` at a time. */
export function LaunchRunsDialog({ open, scenarios, onClose, onLaunched }: LaunchRunsDialogProps) {
  if (!open) return null;
  return <LaunchForm scenarios={scenarios} onClose={onClose} onLaunched={onLaunched} />;
}

function LaunchForm({ scenarios, onClose, onLaunched }: Omit<LaunchRunsDialogProps, "open">) {
  const launch = useLaunchRuns();
  const [draft, setDraft] = useState<LaunchDraft>(DEFAULT_DRAFT);
  const [errors, setErrors] = useState<LaunchErrors>({});
  // A ref, not mutation state: two clicks can land before React re-renders the disabled button.
  const sending = useRef(false);
  // While a launch is in flight the dialog stays open: closing would unmount this form and drop
  // both the guard above and the redirect to the new batch (each run is a real, paid call).
  const busy = launch.isPending;
  const close = () => {
    if (!sending.current) onClose();
  };

  const title = scenarios.length === 1 ? `Launch ${scenarios[0].name}` : `Launch ${scenarios.length} scenarios`;
  const planned = plannedRuns(scenarios.length, draft);
  const refused = launch.isError ? notRunnableReasons(launch.error, scenarios) : [];

  function set(field: keyof LaunchDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const result = toLaunchInput(
      scenarios.map((scenario) => scenario.id),
      draft,
    );
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    sending.current = true;
    launch.mutate(result.input, {
      onSuccess: (batch) => onLaunched(batch),
      onSettled: () => (sending.current = false),
    });
  }

  return (
    <Dialog
      open
      size="lg"
      title={title}
      description="Each run is a real call to the agent: the evaluator plays the caller and every run is recorded."
      onClose={close}
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4">
        {scenarios.length > 1 ? (
          <ul aria-label="Scenarios" className="flex flex-col gap-1 text-sm text-muted">
            {scenarios.map((scenario) => (
              <li key={scenario.id}>{scenario.name}</li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Repetitions" hint={`Runs per scenario (1–${MAX_REPETITIONS}).`} error={errors.repetitions}>
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
          <Field label="Concurrency" hint={`Runs at the same time (1–${MAX_CONCURRENCY}).`} error={errors.concurrency}>
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
        <Field label="Label (optional)" hint="Helps you find this batch later." error={errors.label}>
          {(props) => (
            <Input
              {...props}
              maxLength={MAX_LABEL_LENGTH + 20}
              value={draft.label}
              onChange={(event) => set("label", event.target.value)}
            />
          )}
        </Field>
        <p className="text-sm text-muted">
          {planned === null ? "" : planned === 1 ? "1 run" : `${planned} runs`}
        </p>
        {launch.isError ? (
          refused.length > 0 ? (
            <Alert title="Some scenarios cannot run">
              <ul className="flex flex-col gap-1">
                {refused.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Alert title="Could not launch">{errorMessage(launch.error)}</Alert>
          )
        ) : null}
        <div className="flex flex-wrap justify-end gap-3">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? "Launching…" : "Launch"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
