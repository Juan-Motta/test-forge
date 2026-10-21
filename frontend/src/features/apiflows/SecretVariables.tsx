"use client";

import { useId, useState } from "react";
import { useT } from "@/lib/i18n";
import { Button, ChevronDownIcon, CloseIcon, IconButton, Input, PasswordInput, PlusIcon, cn, focusRing } from "@/ui";
import type { PairRow } from "./connection-form";
import { SecretChip } from "./SecretChip";
import type { SecretReveal } from "./use-secret-reveal";

type SecretVariablesProps = {
  /** Stored secrets (`locked`, a new value only when typed) and new ones. */
  rows: PairRow[];
  onChange: (rows: PairRow[]) => void;
  /** Adds an empty new secret (its key comes from the caller, so keys stay unique). */
  onAdd: () => void;
  error?: string;
  /** The masked hint of each stored secret, by name. */
  hints: Record<string, string>;
  /** The eye of stored secrets; absent where nothing is stored yet. */
  reveal?: SecretReveal;
  /** False once the API holds as many secrets as it can. */
  canAdd: boolean;
};

/**
 * "Secret variables (advanced)": secrets no header sends, for a step's body, query or path
 * (`{{secret.name}}`). Collapsed until opened, and opened by an error to show it.
 */
export function SecretVariables({ rows, onChange, onAdd, error, hints, reveal, canAdd }: SecretVariablesProps) {
  const t = useT();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const expanded = open || Boolean(error);
  const stored = rows.filter((row) => row.locked);
  const added = rows.filter((row) => !row.locked);
  const update = (key: string, value: Partial<PairRow>) =>
    onChange(rows.map((row) => (row.key === key ? { ...row, ...value } : row)));
  function remove(row: PairRow) {
    if (row.locked) reveal?.hide([row.name]);
    onChange(rows.filter((item) => item.key !== row.key));
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setOpen(!expanded)}
        className={cn("flex w-fit items-center gap-1.5 rounded text-xs font-medium text-muted hover:text-fg", focusRing)}
      >
        <ChevronDownIcon size={14} className={cn("transition-transform", !expanded && "-rotate-90")} />
        {t("apis.secretVariables")}
        {rows.length > 0 ? <span className="text-dim">({rows.length})</span> : null}
      </button>
      {expanded ? (
        <div id={panelId} className="flex flex-col gap-2">
          <p className="text-xs text-dim">{t("apis.secretVariablesHint")}</p>
          {stored.length > 0 ? (
            <ul aria-label={t("apis.storedSecrets")} className="flex flex-col gap-2">
              {stored.map((row) => (
                <li key={row.key} className="grid items-center gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
                  <span className="min-w-0">
                    <SecretChip
                      name={row.name}
                      hint={hints[row.name] ?? ""}
                      value={reveal?.shown[row.name]}
                      pending={reveal?.pending.has(row.name)}
                      onToggle={() => void reveal?.toggle(row.name)}
                    />
                  </span>
                  <PasswordInput
                    mono
                    aria-label={t("apis.secretNewValue", { name: row.name })}
                    subject={t("apis.secretNewValue", { name: row.name })}
                    autoComplete="new-password"
                    placeholder={t("apis.replaceValue")}
                    value={row.value}
                    onChange={(event) => update(row.key, { value: event.target.value })}
                  />
                  <Button variant="ghost" aria-label={t("apis.removeSecret", { name: row.name })} onClick={() => remove(row)}>
                    {t("apis.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          {added.map((row, index) => {
            const n = index + 1;
            return (
              <div key={row.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
                <Input
                  mono
                  aria-label={t("apis.secretName", { n })}
                  value={row.name}
                  placeholder="password"
                  onChange={(event) => update(row.key, { name: event.target.value })}
                />
                <PasswordInput
                  mono
                  aria-label={t("apis.secretValue", { n })}
                  subject={t("apis.secretValue", { n })}
                  autoComplete="new-password"
                  value={row.value}
                  onChange={(event) => update(row.key, { value: event.target.value })}
                />
                <IconButton
                  size="sm"
                  label={t("apis.removeSecret", { name: row.name.trim() || String(n) })}
                  icon={<CloseIcon size={14} />}
                  onClick={() => remove(row)}
                />
              </div>
            );
          })}
          {error ? <p className="text-xs text-danger-fg">{error}</p> : null}
          <Button variant="ghost" className="w-fit" icon={<PlusIcon size={14} />} disabled={!canAdd} onClick={onAdd}>
            {t("apis.addSecret")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
