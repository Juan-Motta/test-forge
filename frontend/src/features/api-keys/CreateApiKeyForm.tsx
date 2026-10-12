"use client";

import { useState, type FormEvent } from "react";
import { Alert, Button, Field, Input, Select } from "@/ui";
import type { NewApiKey } from "./types";

export const NAME_MAX = 80;

/** `""` means the key never expires. */
const EXPIRY_OPTIONS = [
  { value: "", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "365 days" },
] as const;

type CreateApiKeyFormProps = {
  onSubmit: (input: NewApiKey) => void;
  onCancel: () => void;
  pending: boolean;
  /** Form-level error from the server. */
  error?: string;
  /** Server-side error for the name field. */
  nameError?: string;
};

function validateName(name: string): string | undefined {
  if (!name) return "Enter a name.";
  if (name.length > NAME_MAX) return `Use at most ${NAME_MAX} characters.`;
  return undefined;
}

/** Name and expiry for a new key. Its state lives only while the create dialog is open. */
export function CreateApiKeyForm({ onSubmit, onCancel, pending, error, nameError }: CreateApiKeyFormProps) {
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("");
  const [localNameError, setLocalNameError] = useState<string | undefined>(undefined);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const trimmed = name.trim();
    const invalid = validateName(trimmed);
    setLocalNameError(invalid);
    if (invalid) return;
    onSubmit({ name: trimmed, expiresInDays: expiry ? Number(expiry) : null });
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      {error ? <Alert>{error}</Alert> : null}
      <Field label="Name" hint="Where the key is used, e.g. “Nightly CI”." error={localNameError ?? nameError}>
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
      <Field label="Expires">
        {(control) => (
          <Select {...control} value={expiry} onChange={(event) => setExpiry(event.target.value)}>
            {EXPIRY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {pending ? "Creating…" : "Create key"}
        </Button>
      </div>
    </form>
  );
}
