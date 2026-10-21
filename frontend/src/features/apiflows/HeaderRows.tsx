"use client";

import { useT } from "@/lib/i18n";
import { Button, CloseIcon, IconButton, Input, PlusIcon } from "@/ui";
import type { HeaderRow } from "./connection-form";

type HeaderRowsProps = {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  /** Adds an empty row (its key comes from the caller, so keys stay unique). */
  onAdd: () => void;
  error?: string;
  /** Keeps the "Default headers" legend for screen readers only (when a card already titles it). */
  legendSrOnly?: boolean;
  /** One line under the legend. */
  hint?: string;
};

/**
 * The default headers every step sends: plain templates, which may use `{{var.name}}`. A header
 * only some steps need (like a login token) belongs on those steps instead.
 */
export function HeaderRows({ rows, onChange, onAdd, error, legendSrOnly = false, hint }: HeaderRowsProps) {
  const t = useT();
  const update = (key: string, change: Partial<HeaderRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={legendSrOnly ? "sr-only" : "mb-1.5 text-xs font-medium text-muted"}>{t("apis.field.headers")}</legend>
      {hint ? <p className="-mt-1 text-xs text-dim">{hint}</p> : null}
      {rows.length === 0 ? <p className="text-xs text-dim">{t("apis.noHeaders")}</p> : null}
      {rows.map((row, index) => {
        const n = index + 1;
        return (
          <div key={row.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-start gap-2">
            <Input
              mono
              aria-label={t("apis.headerName", { n })}
              value={row.name}
              placeholder="Accept"
              onChange={(event) => update(row.key, { name: event.target.value })}
            />
            <Input
              mono
              aria-label={t("apis.headerValue", { n })}
              value={row.value}
              placeholder="application/json"
              onChange={(event) => update(row.key, { value: event.target.value })}
            />
            <IconButton
              size="sm"
              label={t("apis.removeHeader", { name: row.name.trim() || String(n) })}
              icon={<CloseIcon size={14} />}
              onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
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
