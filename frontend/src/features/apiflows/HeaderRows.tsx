"use client";

import { useT } from "@/lib/i18n";
import { Button, CloseIcon, IconButton, Input, PasswordInput, PlusIcon, cn, focusRing } from "@/ui";
import type { HeaderRow } from "./connection-form";
import { SecretChip } from "./SecretChip";
import type { SecretReveal } from "./use-secret-reveal";

type HeaderRowsProps = {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  /** Adds an empty plain row (its key comes from the caller, so keys stay unique). */
  onAdd: () => void;
  error?: string;
  /** Keeps the "Headers" legend for screen readers only (when a card already titles it). */
  legendSrOnly?: boolean;
  /** One line under the legend. */
  hint?: string;
  /** The masked hint of each stored secret, by name. */
  hints: Record<string, string>;
  /** The eye of stored secrets; absent where nothing is stored yet. */
  reveal?: SecretReveal;
  /** False once the API holds as many secrets as it can: no more headers can turn secret. */
  canAddSecret: boolean;
};

/**
 * The headers every step sends. Each row has a Secret switch: a secret header's value is stored
 * sealed and shown masked, with an eye; a stored one keeps its value unless a new one is typed.
 */
export function HeaderRows({ rows, onChange, onAdd, error, legendSrOnly = false, hint, hints, reveal, canAddSecret }: HeaderRowsProps) {
  const t = useT();
  const update = (key: string, change: Partial<HeaderRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  function setSecret(row: HeaderRow, secret: boolean) {
    // A stored secret's value typed so far, or revealed, never turns into a plain value.
    if (row.stored) reveal?.hide([row.stored]);
    update(row.key, { secret, value: row.stored ? "" : row.value });
  }

  function remove(row: HeaderRow) {
    if (row.stored) reveal?.hide([row.stored]);
    onChange(rows.filter((item) => item.key !== row.key));
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={legendSrOnly ? "sr-only" : "mb-1.5 text-xs font-medium text-muted"}>{t("apis.field.headers")}</legend>
      {hint ? <p className="-mt-1 text-xs text-dim">{hint}</p> : null}
      {rows.length === 0 ? <p className="text-xs text-dim">{t("apis.noHeaders")}</p> : null}
      {rows.map((row, index) => {
        const n = index + 1;
        const valueLabel = t("apis.headerValue", { n });
        return (
          <div key={row.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto_auto] items-start gap-2">
            <Input
              mono
              aria-label={t("apis.headerName", { n })}
              value={row.name}
              placeholder={row.secret ? "x-api-key" : "Accept"}
              onChange={(event) => update(row.key, { name: event.target.value })}
            />
            {row.secret && row.stored ? (
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="min-w-0">
                  <SecretChip
                    name={row.stored}
                    hint={hints[row.stored] ?? ""}
                    value={reveal?.shown[row.stored]}
                    pending={reveal?.pending.has(row.stored)}
                    onToggle={() => void reveal?.toggle(row.stored ?? "")}
                  />
                </span>
                <PasswordInput
                  mono
                  aria-label={t("apis.secretNewValue", { name: row.stored })}
                  subject={t("apis.secretNewValue", { name: row.stored })}
                  autoComplete="new-password"
                  placeholder={t("apis.replaceValue")}
                  value={row.value}
                  onChange={(event) => update(row.key, { value: event.target.value })}
                />
              </div>
            ) : row.secret ? (
              <PasswordInput
                mono
                aria-label={valueLabel}
                subject={valueLabel}
                autoComplete="new-password"
                value={row.value}
                onChange={(event) => update(row.key, { value: event.target.value })}
              />
            ) : (
              <Input
                mono
                aria-label={valueLabel}
                value={row.value}
                onChange={(event) => update(row.key, { value: event.target.value })}
              />
            )}
            <label className="flex min-h-9 cursor-pointer items-center gap-1.5 text-xs text-muted">
              <input
                type="checkbox"
                role="switch"
                aria-label={t("apis.headerSecret", { name: row.name.trim() || String(n) })}
                checked={row.secret}
                disabled={!row.secret && !canAddSecret}
                onChange={(event) => setSecret(row, event.target.checked)}
                className={cn("size-4 accent-evaluator", focusRing)}
              />
              {t("apis.secret")}
            </label>
            <IconButton
              size="sm"
              label={t("apis.removeHeader", { name: row.name.trim() || String(n) })}
              icon={<CloseIcon size={14} />}
              onClick={() => remove(row)}
            />
          </div>
        );
      })}
      {error ? <p className="text-xs text-danger-fg">{error}</p> : null}
      <Button variant="ghost" className="w-fit" icon={<PlusIcon size={14} />} onClick={onAdd}>
        {t("apis.addHeader")}
      </Button>
    </fieldset>
  );
}
