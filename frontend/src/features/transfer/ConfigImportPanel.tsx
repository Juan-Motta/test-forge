"use client";

import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useT } from "@/lib/i18n";
import { Button, Field, Textarea } from "@/ui";

/** The largest config file read (configs are a few KB). */
const MAX_FILE_BYTES = 256 * 1024;

type ConfigImportPanelProps = {
  id: string;
  /** Accessible name of the panel, e.g. "Import an agent config". */
  label: string;
  /** Fills the form from the text; returns why it could not, or nothing when it did. */
  onImport: (text: string) => string | undefined;
  /** Escape or Cancel; the opener takes focus back. */
  onCancel: () => void;
};

/**
 * Inline panel inside a form: paste an exported config or pick its `.json` file, then hand the
 * text to the form, which prefills its fields (nothing is saved). Escape closes only this panel.
 */
export function ConfigImportPanel({ id, label, onImport, onCancel }: ConfigImportPanelProps) {
  const t = useT();
  const fileInputId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => textarea.current?.focus(), []);

  function importText(value: string) {
    const problem = onImport(value);
    if (problem) {
      setError(problem);
      textarea.current?.focus();
    }
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError(t("transfer.error.fileTooLarge"));
      return;
    }
    let content: string;
    try {
      content = await file.text();
    } catch {
      setError(t("transfer.error.fileRead"));
      return;
    }
    setText(content);
    setError(undefined);
    importText(content);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onCancel();
  }

  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-4"
    >
      <Field label={t("transfer.importLabel")} hint={t("transfer.importHint")} error={error}>
        {(control) => (
          <Textarea
            ref={textarea}
            mono
            rows={8}
            spellCheck={false}
            autoComplete="off"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setError(undefined);
            }}
            {...control}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={fileInputId} className="text-sm text-muted">
          <span className="mr-2">{t("transfer.importFile")}</span>
          <input id={fileInputId} type="file" accept=".json,application/json" onChange={(event) => void onFile(event)} className="text-sm" />
        </label>
        <div className="flex flex-wrap gap-3">
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" onClick={() => importText(text)}>
            {t("transfer.import")}
          </Button>
        </div>
      </div>
    </div>
  );
}
