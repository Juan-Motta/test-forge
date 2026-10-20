"use client";

import { useT } from "@/lib/i18n";
import { Button, CloseIcon, IconButton, Input, PasswordInput, PlusIcon } from "@/ui";
import type { PairRow } from "./connection-form";

type PairRowsProps = {
  kind: "header" | "secret";
  rows: PairRow[];
  onChange: (rows: PairRow[]) => void;
  /** Adds an empty row (its key comes from the caller, so keys stay unique). */
  onAdd: () => void;
  error?: string;
  max?: number;
};

/**
 * Name/value rows (plain headers, or secrets in password fields). A kept secret shows its name
 * fixed and an empty value that changes it only when typed.
 */
export function PairRows({ kind, rows, onChange, onAdd, error, max }: PairRowsProps) {
  const t = useT();
  const secret = kind === "secret";
  const update = (key: string, change: Partial<PairRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-xs font-medium text-muted">{t(secret ? "apis.field.secrets" : "apis.field.headers")}</legend>
      {rows.length === 0 ? <p className="text-xs text-dim">{t(secret ? "apis.noSecrets" : "apis.noHeaders")}</p> : null}
      {rows.map((row, index) => {
        const n = index + 1;
        const nameLabel = t(secret ? "apis.secretName" : "apis.headerName", { n });
        const valueLabel = row.locked
          ? t("apis.secretNewValue", { name: row.name })
          : t(secret ? "apis.secretValue" : "apis.headerValue", { n });
        return (
          <div key={row.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
            {row.locked ? (
              <span className="truncate font-mono text-xs" title={row.name}>
                {row.name}
              </span>
            ) : (
              <Input
                mono
                aria-label={nameLabel}
                value={row.name}
                placeholder={secret ? "apiKey" : "Accept"}
                onChange={(event) => update(row.key, { name: event.target.value })}
              />
            )}
            {secret ? (
              <PasswordInput
                mono
                aria-label={valueLabel}
                subject={row.locked ? row.name : valueLabel}
                autoComplete="off"
                value={row.value}
                placeholder={row.locked ? t("apis.secretUnchanged") : undefined}
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
            <IconButton
              size="sm"
              label={t(secret ? "apis.removeSecret" : "apis.removeHeader", { name: row.name || String(n) })}
              icon={<CloseIcon size={14} />}
              onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
            />
          </div>
        );
      })}
      {error ? <p className="text-xs text-danger-fg">{error}</p> : null}
      <Button
        variant="ghost"
        className="w-fit"
        icon={<PlusIcon size={14} />}
        disabled={max !== undefined && rows.length >= max}
        onClick={onAdd}
      >
        {t(secret ? "apis.addSecret" : "apis.addHeader")}
      </Button>
    </fieldset>
  );
}
