"use client";

import { useId } from "react";
import { useT } from "@/lib/i18n";
import { Button, CloseIcon, IconButton, Input, PasswordInput, PlusIcon, cn, focusRing } from "@/ui";
import { MAX_SECRETS, MAX_VARIABLES, variableCounts, type VariableRow } from "./connection-form";
import { SecretChip } from "./SecretChip";
import type { SecretReveal } from "./use-secret-reveal";

type ConnectionVariablesProps = {
  /** Stored variables (plain and secret, their names fixed), then new ones. */
  rows: VariableRow[];
  onChange: (rows: VariableRow[]) => void;
  /** Adds an empty plain variable (its key comes from the caller, so keys stay unique). */
  onAdd: () => void;
  /** An error of the whole section. */
  error?: string;
  /** The server's errors by variable name (a name already a secret, a refused value). */
  rowErrors?: Record<string, string>;
  /** Keeps the "Variables" legend for screen readers only (when a card already titles it). */
  legendSrOnly?: boolean;
  /** One line under the legend. */
  hint?: string;
  /** The masked hint of each stored secret, by name. */
  hints: Record<string, string>;
  /** The eye of stored secrets; absent where nothing is stored yet. */
  reveal?: SecretReveal;
};

/**
 * The connection's variables, which any step uses as `{{var.name}}`. Each row has a Secret
 * switch: a secret's value is stored sealed and shown masked, with an eye that fetches it only
 * when clicked; a stored one keeps its value unless a new one is typed. Plain values are edited
 * as they are.
 */
export function ConnectionVariables(props: ConnectionVariablesProps) {
  const { rows, onChange, onAdd, error, rowErrors = {}, legendSrOnly = false, hint, hints, reveal } = props;
  const t = useT();
  const baseId = useId();
  const counts = variableCounts(rows);
  const update = (key: string, change: Partial<VariableRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  function setSecret(row: VariableRow, secret: boolean) {
    // A stored secret's value, revealed or typed as its replacement, never turns into a plain value.
    if (row.stored?.secret) {
      reveal?.hide([row.name]);
      update(row.key, { secret, value: "" });
    } else {
      update(row.key, { secret });
    }
  }

  function remove(row: VariableRow) {
    if (row.stored?.secret) reveal?.hide([row.name]);
    onChange(rows.filter((item) => item.key !== row.key));
  }

  // New rows are numbered among themselves: "Variable name 1" is the first one added.
  const numbers = new Map(rows.filter((row) => !row.stored).map((row, index) => [row.key, index + 1]));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={legendSrOnly ? "sr-only" : "mb-1.5 text-xs font-medium text-muted"}>{t("apis.variables")}</legend>
      {hint ? <p className="-mt-1 text-xs text-dim">{hint}</p> : null}
      {rows.length === 0 ? <p className="text-xs text-dim">{t("apis.noVariables")}</p> : null}
      {rows.map((row) => {
        const n = numbers.get(row.key) ?? 0;
        const label = row.stored ? row.name : row.name.trim() || String(n);
        const rowError = row.name ? rowErrors[row.stored ? row.name : row.name.trim()] : undefined;
        const errorId = `${baseId}-${row.key}-error`;
        const described = rowError ? { "aria-describedby": errorId, "aria-invalid": true as const } : {};
        const valueLabel = row.stored ? t("apis.variableValueOf", { name: row.name }) : t("apis.variableValue", { n });
        const switchDisabled = row.secret ? counts.plain >= MAX_VARIABLES : counts.secret >= MAX_SECRETS;
        return (
          <div key={row.key} className="flex flex-col gap-1">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto_auto] items-start gap-2">
              {row.stored ? (
                <span className="flex min-h-9 min-w-0 items-center font-mono text-xs break-all text-fg">
                  {row.stored.secret && row.secret ? (
                    <SecretChip
                      name={row.name}
                      hint={hints[row.name] ?? ""}
                      value={reveal?.shown[row.name]}
                      pending={reveal?.pending.has(row.name)}
                      onToggle={() => void reveal?.toggle(row.name)}
                    />
                  ) : (
                    row.name
                  )}
                </span>
              ) : (
                <Input
                  mono
                  aria-label={t("apis.variableName", { n })}
                  value={row.name}
                  placeholder={row.secret ? "password" : "tenant_id"}
                  onChange={(event) => update(row.key, { name: event.target.value })}
                  {...described}
                />
              )}
              {row.stored?.secret && row.secret ? (
                <PasswordInput
                  mono
                  aria-label={t("apis.secretNewValue", { name: row.name })}
                  subject={t("apis.secretNewValue", { name: row.name })}
                  autoComplete="new-password"
                  placeholder={t("apis.replaceValue")}
                  value={row.value}
                  onChange={(event) => update(row.key, { value: event.target.value })}
                  {...described}
                />
              ) : row.secret ? (
                <PasswordInput
                  mono
                  aria-label={valueLabel}
                  subject={valueLabel}
                  autoComplete="new-password"
                  value={row.value}
                  onChange={(event) => update(row.key, { value: event.target.value })}
                  {...described}
                />
              ) : (
                <Input
                  mono
                  aria-label={valueLabel}
                  value={row.value}
                  onChange={(event) => update(row.key, { value: event.target.value })}
                  {...described}
                />
              )}
              <label className="flex min-h-9 cursor-pointer items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={t("apis.variableSecret", { name: label })}
                  checked={row.secret}
                  disabled={switchDisabled}
                  onChange={(event) => setSecret(row, event.target.checked)}
                  className={cn("size-4 accent-evaluator", focusRing)}
                />
                {t("apis.secret")}
              </label>
              {row.stored ? (
                <Button variant="ghost" aria-label={t("apis.removeVariable", { name: label })} onClick={() => remove(row)}>
                  {t("apis.remove")}
                </Button>
              ) : (
                <IconButton
                  size="sm"
                  label={t("apis.removeVariable", { name: label })}
                  icon={<CloseIcon size={14} />}
                  onClick={() => remove(row)}
                />
              )}
            </div>
            {rowError ? (
              <p id={errorId} className="text-xs text-danger-fg">
                {rowError}
              </p>
            ) : null}
          </div>
        );
      })}
      {error ? <p className="text-xs text-danger-fg">{error}</p> : null}
      <Button variant="ghost" className="w-fit" icon={<PlusIcon size={14} />} disabled={counts.plain >= MAX_VARIABLES} onClick={onAdd}>
        {t("apis.addVariable")}
      </Button>
    </fieldset>
  );
}
