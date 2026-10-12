"use client";

import { useFieldArray, useWatch, type Control } from "react-hook-form";
import { Button, Field, Input, PlusIcon } from "@/ui";
import type { SectionProps } from "./editor-form";
import { RowLabel } from "./FactsEditor";
import { INTERRUPT_AFTER_S, MAX_INTERRUPTIONS, newInterruption, type ScenarioFormValues } from "./form-schema";

type InterruptionsEditorProps = SectionProps & { control: Control<ScenarioFormValues> };

/** Rows "interrupt agent reply #N after X s": the caller barges in mid-reply, like a person would. */
export function InterruptionsEditor({ control, registerField, fieldError }: InterruptionsEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "interruptions" });
  const rows = useWatch({ control, name: "interruptions" }) ?? [];
  const listError = fieldError("interruptions.root") ?? fieldError("interruptions");
  const full = fields.length >= MAX_INTERRUPTIONS;

  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 ? <p className="text-sm text-muted">The caller never interrupts the agent.</p> : null}
      {fields.map((row, index) => {
        const prefix = `Interruption ${index + 1}`;
        const values = rows[index];
        return (
          <div key={row.id} className="flex flex-col gap-1.5">
            <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Field label={<RowLabel prefix={prefix} text="Agent reply #" />} error={fieldError(`interruptions.${index}.agentTurn`)}>
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
              <Field label={<RowLabel prefix={prefix} text="After (s)" />} error={fieldError(`interruptions.${index}.afterS`)}>
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
              <Button
                variant="ghost"
                className="sm:mt-6"
                aria-label={`Remove interruption ${index + 1}`}
                onClick={() => remove(index)}
              >
                Remove
              </Button>
            </div>
            {values ? (
              <p className="text-xs text-muted">
                {`Interrupt agent reply #${values.agentTurn.trim() || "?"} after ${values.afterS.trim() || "?"} s`}
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
          Add interruption
        </Button>
        <p className="text-xs text-muted">{`Up to ${MAX_INTERRUPTIONS} interruptions.`}</p>
      </div>
    </div>
  );
}
