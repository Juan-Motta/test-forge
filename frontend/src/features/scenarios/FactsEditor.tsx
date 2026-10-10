"use client";

import { useFieldArray, type Control } from "react-hook-form";
import { Button, Field, Input, PlusIcon } from "@/ui";
import type { SectionProps } from "./editor-form";
import type { ScenarioFormValues } from "./form-schema";

type FactsEditorProps = SectionProps & { control: Control<ScenarioFormValues> };

/** Key/value rows the caller reveals only when asked. */
export function FactsEditor({ control, registerField, fieldError }: FactsEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "facts" });
  const listError = fieldError("facts.root") ?? fieldError("facts");

  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 ? <p className="text-sm text-muted">No facts yet.</p> : null}
      {fields.map((row, index) => (
        <div key={row.id} className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
          <Field label={<RowLabel prefix={`Fact ${index + 1}`} text="Key" />} error={fieldError(`facts.${index}.key`)}>
            {(props) => <Input autoComplete="off" {...props} {...registerField(`facts.${index}.key`)} />}
          </Field>
          <Field label={<RowLabel prefix={`Fact ${index + 1}`} text="Value" />} error={fieldError(`facts.${index}.value`)}>
            {(props) => <Input autoComplete="off" {...props} {...registerField(`facts.${index}.value`)} />}
          </Field>
          <Button variant="ghost" className="sm:mt-6" aria-label={`Remove fact ${index + 1}`} onClick={() => remove(index)}>
            Remove
          </Button>
        </div>
      ))}
      {listError ? (
        <p data-error-focus tabIndex={-1} className="text-xs text-danger-fg focus:outline-none">
          {listError}
        </p>
      ) : null}
      <div>
        <Button variant="secondary" icon={<PlusIcon size={16} />} onClick={() => append({ key: "", value: "" })}>
          Add fact
        </Button>
      </div>
    </div>
  );
}

/** A visible short label ("Key") whose accessible name also says which row ("Fact 2 Key"). */
export function RowLabel({ prefix, text }: { prefix: string; text: string }) {
  return (
    <>
      <span className="sr-only">{prefix} </span>
      {text}
    </>
  );
}
