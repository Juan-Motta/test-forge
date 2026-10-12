"use client";

import { useId, type ReactNode } from "react";
import { useFieldArray, type Control } from "react-hook-form";
import { Button, CloseIcon, PlusIcon, cn, focusRing, type FieldControlProps } from "@/ui";
import type { SectionProps } from "./editor-form";
import type { ScenarioFormValues } from "./form-schema";

type FactsEditorProps = SectionProps & { control: Control<ScenarioFormValues> };

/** Key/value tiles the caller reveals only when asked: the key reads as a label, the value in mono. */
export function FactsEditor({ control, registerField, fieldError }: FactsEditorProps) {
  const { fields, append, remove } = useFieldArray({ control, name: "facts" });
  const listError = fieldError("facts.root") ?? fieldError("facts");

  return (
    <div className="flex flex-col gap-2">
      {fields.length === 0 ? <p className="text-sm text-muted">No facts yet.</p> : null}
      {fields.length > 0 ? (
        <ul className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))]">
          {fields.map((row, index) => (
            <li
              key={row.id}
              className="flex items-start gap-2 rounded-lg border border-line bg-field px-2 py-1.5 text-[13px]"
            >
              <InlineField label={`Fact ${index + 1} Key`} error={fieldError(`facts.${index}.key`)} className="min-w-0 flex-1">
                {(props) => (
                  <input
                    autoComplete="off"
                    placeholder="Key"
                    className={inlineControl("text-muted")}
                    {...props}
                    {...registerField(`facts.${index}.key`)}
                  />
                )}
              </InlineField>
              <InlineField label={`Fact ${index + 1} Value`} error={fieldError(`facts.${index}.value`)} className="min-w-0 flex-[1.4]">
                {(props) => (
                  <input
                    autoComplete="off"
                    placeholder="Value"
                    className={inlineControl("text-right font-mono text-xs text-fg")}
                    {...props}
                    {...registerField(`facts.${index}.value`)}
                  />
                )}
              </InlineField>
              <button
                type="button"
                aria-label={`Remove fact ${index + 1}`}
                onClick={() => remove(index)}
                className={cn("mt-1 grid size-8 shrink-0 place-items-center rounded-md text-dim hover:bg-active hover:text-fg", focusRing)}
              >
                <CloseIcon size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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

/** Classes of a borderless control inside a row tile (the tile draws the frame). */
export function inlineControl(className?: string) {
  return cn(
    "min-h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 placeholder:text-dim",
    "hover:border-field-line aria-invalid:border-danger",
    focusRing,
    className,
  );
}

/**
 * A row control whose label is visually hidden (the row reads like the design's compact tiles)
 * but still names it ("Fact 2 Key"), with its error wired as the description.
 */
export function InlineField({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      {children({ id, "aria-describedby": error ? errorId : undefined, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={errorId} className="px-2 text-xs text-danger-fg">
          {error}
        </p>
      ) : null}
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
