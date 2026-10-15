"use client";

import { useState, type FormEvent } from "react";
import { useT, type Translator } from "@/lib/i18n";
import { Alert, Button, Field, Input, Select } from "@/ui";
import type { NewApiKey } from "./types";

export const NAME_MAX = 80;

/** `""` means the key never expires. */
const EXPIRY_DAYS = ["", "30", "90", "365"] as const;

type CreateApiKeyFormProps = {
  onSubmit: (input: NewApiKey) => void;
  onCancel: () => void;
  pending: boolean;
  /** Form-level error from the server. */
  error?: string;
  /** Server-side error for the name field. */
  nameError?: string;
};

function validateName(t: Translator, name: string): string | undefined {
  if (!name) return t("scenarios.error.name");
  if (name.length > NAME_MAX) return t("common.maxChars", { max: NAME_MAX });
  return undefined;
}

/** Name and expiry for a new key. Its state lives only while the create dialog is open. */
export function CreateApiKeyForm({ onSubmit, onCancel, pending, error, nameError }: CreateApiKeyFormProps) {
  const t = useT();
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [localNameError, setLocalNameError] = useState<string | undefined>(undefined);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const trimmed = name.trim();
    const invalid = validateName(t, trimmed);
    setLocalNameError(invalid);
    if (invalid) return;
    onSubmit({ name: trimmed, expiresInDays: expiry ? Number(expiry) : null });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      {error ? <Alert>{error}</Alert> : null}
      <Field label={t("scenarios.field.name")} hint={t("apiKeys.nameHint")} error={localNameError ?? nameError}>
        {(control) => (
          <Input
            {...control}
            value={name}
            autoComplete="off"
            onChange={(event) => {
              setName(event.target.value);
              setLocalNameError(undefined);
            }}
          />
        )}
      </Field>
      <Field label={t("apiKeys.expires")}>
        {(control) => (
          <Select {...control} value={expiry} onChange={(event) => setExpiry(event.target.value)}>
            {EXPIRY_DAYS.map((days) => (
              <option key={days} value={days}>
                {days ? t("apiKeys.days", { count: days }) : t("apiKeys.never")}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={pending}>
          {pending ? t("apiKeys.creating") : t("apiKeys.createKey")}
        </Button>
      </div>
    </form>
  );
}
