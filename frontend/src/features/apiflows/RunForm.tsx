"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError } from "@/lib/api";
import { localErrorMessage, useT } from "@/lib/i18n";
import { Alert, Button, Field, Input, PlayIcon, Select, Spinner } from "@/ui";
import { runHref } from "./ApiTable";
import { useRunFlow } from "./queries";
import { initialRunValues, runInputsOf } from "./run-view";
import type { Api, Flow, FlowInput } from "./types";

type RunFormProps = {
  flow: Pick<Flow, "name" | "inputs">;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  errors: Record<string, string>;
  /** Shown above the button: a 502 (AI could not write the inputs) or any other failure. */
  alert?: { title?: string; message: string };
  running: boolean;
  onSubmit: () => void;
};

/** One field per flow input, prefilled with its default, and "Run flow". */
export function RunForm({ flow, values, onChange, errors, alert, running, onSubmit }: RunFormProps) {
  const t = useT();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!running) onSubmit();
  }
  return (
    <form
      aria-label={t("flowRuns.formTitle", { name: flow.name })}
      onSubmit={submit}
      className="flex min-w-0 flex-col gap-4 rounded-xl border border-line bg-panel p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold break-words">{t("flowRuns.formTitle", { name: flow.name })}</h2>
        <p className="text-sm text-muted">{flow.inputs.length > 0 ? t("flowRuns.formHint") : t("flowRuns.noInputs")}</p>
      </div>
      {flow.inputs.length > 0 ? (
        <fieldset disabled={running} className="grid gap-4 sm:grid-cols-2">
          {flow.inputs.map((input) => (
            <InputField
              key={input.name}
              input={input}
              value={values[input.name] ?? ""}
              error={errors[input.name]}
              onChange={(value) => onChange(input.name, value)}
            />
          ))}
        </fieldset>
      ) : null}
      {alert ? <Alert title={alert.title}>{alert.message}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={running} icon={running ? <Spinner size={14} /> : <PlayIcon size={14} />}>
          {t("flows.run")}
        </Button>
        {running ? (
          <span role="status" className="text-sm text-muted">
            {t("flowRuns.running")}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function InputField({ input, value, error, onChange }: { input: FlowInput; value: string; error?: string; onChange: (value: string) => void }) {
  const t = useT();
  const hint = input.generate ? t("flowRuns.aiHint") : input.description || undefined;
  return (
    <Field label={<span className="font-mono">{input.name}</span>} hint={hint} error={error}>
      {(props) =>
        input.type === "boolean" ? (
          <Select {...props} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">{t("flowRuns.boolean.empty")}</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </Select>
        ) : (
          <Input
            {...props}
            mono
            inputMode={input.type === "number" ? "decimal" : undefined}
            placeholder={input.generate ?? undefined}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )
      }
    </Field>
  );
}

/** `?flow=<id>&run=new`: runs the flow with the form's values, then opens the new run. */
export function RunFormContainer({ api, flow }: { api: Pick<Api, "id">; flow: Flow }) {
  const t = useT();
  const router = useRouter();
  const run = useRunFlow();
  const [values, setValues] = useState(() => initialRunValues(flow.inputs));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<RunFormProps["alert"]>();

  async function submit() {
    setErrors({});
    setAlert(undefined);
    try {
      const created = await run.mutateAsync({ flowId: flow.id, inputs: runInputsOf(flow.inputs, values) });
      router.push(runHref(api, flow.id, created.id));
    } catch (error) {
      if (error instanceof ApiError && error.status === 502) {
        setAlert({ title: t("flowRuns.aiFailed"), message: error.message });
        return;
      }
      if (error instanceof ApiError && error.status === 422 && Object.keys(error.fieldErrors).length > 0) {
        const placed: Record<string, string> = {};
        const other: string[] = [];
        for (const [path, message] of Object.entries(error.fieldErrors)) {
          const name = path.startsWith("inputs.") ? path.slice("inputs.".length) : undefined;
          if (name !== undefined && flow.inputs.some((input) => input.name === name)) placed[name] = message;
          else other.push(`${path}: ${message}`);
        }
        setErrors(placed);
        setAlert({ message: [t("common.checkFields"), ...other].join(" ") });
        return;
      }
      setAlert({ message: localErrorMessage(t, error) });
    }
  }

  return (
    <RunForm
      flow={flow}
      values={values}
      onChange={(name, value) => {
        setValues((current) => ({ ...current, [name]: value }));
        setErrors((current) => {
          const rest = { ...current };
          delete rest[name];
          return rest;
        });
      }}
      errors={errors}
      alert={alert}
      running={run.isPending}
      onSubmit={() => void submit()}
    />
  );
}
