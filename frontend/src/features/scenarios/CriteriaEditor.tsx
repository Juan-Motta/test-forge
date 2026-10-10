"use client";

import { useFieldArray, useWatch, type Control } from "react-hook-form";
import { Badge, Button, Field, Input, PlusIcon, Select, cn } from "@/ui";
import type { SectionProps } from "./editor-form";
import { RowLabel } from "./FactsEditor";
import {
  KIND_LABELS,
  newCriterion,
  SOURCE_LABELS,
  WEIGHT_TOTAL,
  weightTotal,
  type ScenarioFormValues,
} from "./form-schema";
import { CRITERION_KINDS, EVIDENCE_SOURCES } from "./types";

type CriteriaEditorProps = SectionProps & { control: Control<ScenarioFormValues> };

/** Weighted success criteria for the judge, with a live total that must reach exactly 100. */
export function CriteriaEditor({ control, registerField, fieldError }: CriteriaEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "criteria" });
  const rows = useWatch({ control, name: "criteria" });
  const total = weightTotal(rows ?? []);
  const listError = fieldError("criteria.root") ?? fieldError("criteria");

  function add() {
    const remaining = WEIGHT_TOTAL - total;
    append(newCriterion(remaining > 0 ? String(remaining) : ""));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">The judge scores each criterion; Must criteria fail the call when missed.</p>
        <Badge tone={total === WEIGHT_TOTAL ? "success" : "danger"}>
          <span aria-live="polite">{`Weights total ${total} of ${WEIGHT_TOTAL}`}</span>
        </Badge>
      </div>
      {fields.map((row, index) => {
        const prefix = `Criterion ${index + 1}`;
        return (
          <div
            key={row.id}
            className="grid items-start gap-3 rounded-lg border border-line bg-raised p-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)_6rem_auto]"
          >
            <Field label={<RowLabel prefix={prefix} text="Text" />} error={fieldError(`criteria.${index}.text`)}>
              {(props) => <Input autoComplete="off" {...props} {...registerField(`criteria.${index}.text`)} />}
            </Field>
            <Field label={<RowLabel prefix={prefix} text="Kind" />} error={fieldError(`criteria.${index}.kind`)}>
              {(props) => (
                <Select {...props} {...registerField(`criteria.${index}.kind`)}>
                  {CRITERION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={<RowLabel prefix={prefix} text="Evidence" />} error={fieldError(`criteria.${index}.source`)}>
              {(props) => (
                <Select {...props} {...registerField(`criteria.${index}.source`)}>
                  {EVIDENCE_SOURCES.map((source) => (
                    <option key={source} value={source}>
                      {SOURCE_LABELS[source]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={<RowLabel prefix={prefix} text="Weight" />} error={fieldError(`criteria.${index}.weight`)}>
              {(props) => (
                <Input
                  mono
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={WEIGHT_TOTAL}
                  step={1}
                  {...props}
                  {...registerField(`criteria.${index}.weight`)}
                />
              )}
            </Field>
            <Button
              variant="ghost"
              className="sm:mt-6"
              aria-label={`Remove criterion ${index + 1}`}
              disabled={fields.length === 1}
              onClick={() => remove(index)}
            >
              Remove
            </Button>
          </div>
        );
      })}
      {listError ? (
        <p data-error-focus tabIndex={-1} className={cn("text-sm text-danger-fg focus:outline-none")}>
          {listError}
        </p>
      ) : null}
      <div>
        <Button variant="secondary" icon={<PlusIcon size={16} />} onClick={add} disabled={fields.length >= 30}>
          Add criterion
        </Button>
      </div>
    </div>
  );
}
