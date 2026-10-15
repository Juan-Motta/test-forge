"use client";

import { useFieldArray, useWatch, type Control } from "react-hook-form";
import { useT } from "@/lib/i18n";
import { Button, CloseIcon, Field, Input, PlusIcon, cn, focusRing } from "@/ui";
import type { SectionProps } from "./editor-form";
import { RowLabel } from "./FactsEditor";
import { INTERRUPT_AFTER_S, MAX_INTERRUPTIONS, newInterruption, type ScenarioFormValues } from "./form-schema";

type InterruptionsEditorProps = SectionProps & { control: Control<ScenarioFormValues> };

/** Rows "interrupt agent reply #N after X s": the caller barges in mid-reply, like a person would. */
export function InterruptionsEditor({ control, registerField, fieldError }: InterruptionsEditorProps) {
  const t = useT();
  const { fields, append, remove } = useFieldArray({ control, name: "interruptions" });
  const rows = useWatch({ control, name: "interruptions" }) ?? [];
  const listError = fieldError("interruptions.root") ?? fieldError("interruptions");
  const full = fields.length >= MAX_INTERRUPTIONS;

  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 ? <p className="text-sm text-muted">{t("scenarios.noInterruptions")}</p> : null}
      {fields.map((row, index) => {
        const prefix = t("live.interruption", { n: index + 1 });
        const values = rows[index];
        return (
          <div key={row.id} className="flex flex-col gap-2 rounded-lg border border-line bg-field p-3">
            <div className="grid items-start gap-3 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Field label={<RowLabel prefix={prefix} text={t("scenarios.agentReply")} />} error={fieldError(`interruptions.${index}.agentTurn`)}>
                {(props) => (
                  <Input
                    mono
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    {...props}
                    {...registerField(`interruptions.${index}.agentTurn`)}
                  />
                )}
              </Field>
              <Field label={<RowLabel prefix={prefix} text={t("scenarios.afterS")} />} error={fieldError(`interruptions.${index}.afterS`)}>
                {(props) => (
                  <Input
                    mono
                    type="number"
                    inputMode="decimal"
                    min={INTERRUPT_AFTER_S.min}
                    max={INTERRUPT_AFTER_S.max}
                    step={0.1}
                    {...props}
                    {...registerField(`interruptions.${index}.afterS`)}
                  />
                )}
              </Field>
              <button
                type="button"
                aria-label={t("scenarios.removeInterruption", { n: index + 1 })}
                onClick={() => remove(index)}
                className={cn(
                  "mt-7 grid size-9 place-items-center rounded-md text-dim hover:bg-active hover:text-fg",
                  focusRing,
                )}
              >
                <CloseIcon size={14} />
              </button>
            </div>
            {values ? (
              <p className="font-mono text-xs text-evaluator-fg">
                {t("scenarios.interruptionSummary", { turn: values.agentTurn.trim() || "?", seconds: values.afterS.trim() || "?" })}
              </p>
            ) : null}
          </div>
        );
      })}
      {listError ? (
        <p data-error-focus tabIndex={-1} className="text-xs text-danger-fg focus:outline-none">
          {listError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          icon={<PlusIcon size={16} />}
          disabled={full}
          onClick={() => append(newInterruption(rows))}
        >
          {t("scenarios.addInterruption")}
        </Button>
        <p className="text-xs text-muted">{t("scenarios.upToInterruptions", { max: MAX_INTERRUPTIONS })}</p>
      </div>
    </div>
  );
}
