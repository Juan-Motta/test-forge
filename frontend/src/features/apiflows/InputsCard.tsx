"use client";

import { useT } from "@/lib/i18n";
import { Button, Card, CardHeader, CloseIcon, IconButton, Input, PlusIcon, Select } from "@/ui";
import { newInput, type InputDraft } from "./flow-draft";
import type { FlowInput } from "./types";

const TYPES: FlowInput["type"][] = ["text", "number", "boolean"];

type InputsCardProps = {
  inputs: InputDraft[];
  onChange: (inputs: InputDraft[]) => void;
  /** Errors by row (`inputs.<i>`). */
  errors: Record<string, string>;
};

/** The flow's inputs: name, type, description, default, and what AI writes the value from. */
export function InputsCard({ inputs, onChange, errors }: InputsCardProps) {
  const t = useT();
  const update = (key: string, change: Partial<InputDraft>) =>
    onChange(inputs.map((input) => (input.key === key ? { ...input, ...change } : input)));

  return (
    <Card aria-labelledby="flow-inputs">
      <CardHeader id="flow-inputs" title={t("flows.inputs")} />
      <p className="text-xs text-dim">{t("flows.inputsHelp")}</p>
      {inputs.length === 0 ? <p className="text-xs text-muted">{t("flows.noInputs")}</p> : null}
      {inputs.map((input, index) => {
        const n = index + 1;
        const error = errors[`inputs.${index}`];
        const errorId = `${input.key}-error`;
        const described = error ? { "aria-describedby": errorId, "aria-invalid": true as const } : {};
        return (
          <div key={input.key} role="group" aria-label={t("flows.input", { n })} className="flex flex-col gap-1.5">
            <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto]">
              <Input
                mono
                aria-label={t("flows.input.name", { n })}
                placeholder="query"
                value={input.name}
                onChange={(event) => update(input.key, { name: event.target.value })}
                {...described}
              />
              <Select
                aria-label={t("flows.input.type", { n })}
                value={input.type}
                onChange={(event) => update(input.key, { type: event.target.value as FlowInput["type"] })}
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`flows.type.${type}`)}
                  </option>
                ))}
              </Select>
              <Input
                aria-label={t("flows.input.description", { n })}
                placeholder={t("flows.input.descriptionPlaceholder")}
                value={input.description}
                onChange={(event) => update(input.key, { description: event.target.value })}
              />
              <Input
                mono
                aria-label={t("flows.input.default", { n })}
                placeholder={t("flows.input.defaultPlaceholder")}
                value={input.default}
                onChange={(event) => update(input.key, { default: event.target.value })}
              />
              <Input
                aria-label={t("flows.input.generate", { n })}
                placeholder={t("flows.input.generatePlaceholder")}
                value={input.generate}
                onChange={(event) => update(input.key, { generate: event.target.value })}
              />
              <IconButton
                size="sm"
                label={t("flows.removeInput", { n })}
                icon={<CloseIcon size={14} />}
                onClick={() => onChange(inputs.filter((item) => item.key !== input.key))}
              />
            </div>
            {error ? (
              <p id={errorId} className="text-xs text-danger-fg">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
      <Button variant="ghost" className="w-fit" icon={<PlusIcon size={14} />} onClick={() => onChange([...inputs, newInput()])}>
        {t("flows.addInput")}
      </Button>
    </Card>
  );
}
