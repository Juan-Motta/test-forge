"use client";

import { useFieldArray, useWatch, type Control } from "react-hook-form";
import { Badge, Button, CloseIcon, PlusIcon, cn, focusRing } from "@/ui";
import type { SectionProps } from "./editor-form";
import { InlineField, inlineControl } from "./FactsEditor";
import {
  KIND_LABELS,
  newCriterion,
  SOURCE_LABELS,
  WEIGHT_TOTAL,
  weightTotal,
  type ScenarioFormValues,
} from "./form-schema";
import { CRITERION_KINDS, EVIDENCE_SOURCES, type CriterionKind } from "./types";

type CriteriaEditorProps = SectionProps & { control: Control<ScenarioFormValues> };

const KIND_TONE: Record<CriterionKind, string> = {
  must: "bg-danger/15 text-danger-fg",
  should: "bg-agent/15 text-agent-fg",
};

/** The live weight total; the criteria must reach exactly 100% to save. */
export function WeightsStatus({ control }: { control: Control<ScenarioFormValues> }) {
  const rows = useWatch({ control, name: "criteria" });
  const total = weightTotal(rows ?? []);
  return (
    <Badge tone={total === WEIGHT_TOTAL ? "success" : "danger"}>
      <span aria-live="polite">{`Weights total ${total}%`}</span>
    </Badge>
  );
}

/** Weighted success criteria for the judge: one compact row each (kind chip, text, evidence pill, weight). */
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
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted">The judge scores each criterion; Must criteria fail the call when missed.</p>
      <ul className="flex flex-col gap-2">
        {fields.map((row, index) => {
          const prefix = `Criterion ${index + 1}`;
          const kind = rows?.[index]?.kind ?? row.kind;
          return (
            <li
              key={row.id}
              className="flex flex-wrap items-start gap-2.5 rounded-lg border border-line bg-field px-2.5 py-1.5"
            >
              <InlineField label={`${prefix} Kind`} error={fieldError(`criteria.${index}.kind`)}>
                {(props) => (
                  <select
                    className={cn(
                      "mt-1.5 min-h-7 cursor-pointer appearance-none rounded-md border-0 px-2 text-[11px] font-semibold",
                      focusRing,
                      KIND_TONE[kind],
                    )}
                    {...props}
                    {...registerField(`criteria.${index}.kind`)}
                  >
                    {CRITERION_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {KIND_LABELS[value]}
                      </option>
                    ))}
                  </select>
                )}
              </InlineField>
              <InlineField label={`${prefix} Text`} error={fieldError(`criteria.${index}.text`)} className="min-w-0 flex-[1_1_240px]">
                {(props) => (
                  <input
                    autoComplete="off"
                    placeholder="What the agent must do"
                    className={inlineControl("text-sm text-fg")}
                    {...props}
                    {...registerField(`criteria.${index}.text`)}
                  />
                )}
              </InlineField>
              <InlineField label={`${prefix} Evidence`} error={fieldError(`criteria.${index}.source`)}>
                {(props) => (
                  <select
                    className={cn(
                      "mt-1.5 min-h-7 cursor-pointer appearance-none rounded-full border border-field-line bg-transparent px-2.5 text-[11px] text-muted",
                      focusRing,
                    )}
                    {...props}
                    {...registerField(`criteria.${index}.source`)}
                  >
                    {EVIDENCE_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {SOURCE_LABELS[source]}
                      </option>
                    ))}
                  </select>
                )}
              </InlineField>
              <InlineField label={`${prefix} Weight`} error={fieldError(`criteria.${index}.weight`)} className="w-[5.5rem]">
                {(props) => (
                  <span className="flex items-center gap-0.5 font-mono text-xs text-muted">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={WEIGHT_TOTAL}
                      step={1}
                      className={inlineControl("text-right font-mono text-xs text-fg")}
                      {...props}
                      {...registerField(`criteria.${index}.weight`)}
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                )}
              </InlineField>
              <button
                type="button"
                aria-label={`Remove criterion ${index + 1}`}
                disabled={fields.length === 1}
                onClick={() => remove(index)}
                className={cn(
                  "mt-0.5 grid size-8 shrink-0 place-items-center rounded-md text-dim hover:bg-active hover:text-fg",
                  "disabled:cursor-not-allowed disabled:opacity-40",
                  focusRing,
                )}
              >
                <CloseIcon size={14} />
              </button>
            </li>
          );
        })}
      </ul>
      {listError ? (
        <p data-error-focus tabIndex={-1} className="text-sm text-danger-fg focus:outline-none">
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
