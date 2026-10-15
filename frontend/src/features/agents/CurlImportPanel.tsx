"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useT } from "@/lib/i18n";
import { Button, Field, Textarea } from "@/ui";
import { parseAgentCurl, type CurlImportResult } from "./curl-import";

export type CurlImportSuccess = Extract<CurlImportResult, { ok: true }>;

type CurlImportPanelProps = {
  id: string;
  onImport: (result: CurlImportSuccess) => void;
  /** Escape or Cancel; the opener takes focus back. */
  onCancel: () => void;
};

/**
 * Inline panel inside the agent form: paste a cURL command copied from the browser's devtools
 * and hand the parsed connection fields to the form. The textarea takes focus on open; Escape
 * closes only this panel, not the surrounding dialog.
 */
export function CurlImportPanel({ id, onImport, onCancel }: CurlImportPanelProps) {
  const t = useT();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => textarea.current?.focus(), []);

  function onImportClick() {
    const result = parseAgentCurl(t, text);
    if (!result.ok) {
      setError(result.error);
      textarea.current?.focus();
      return;
    }
    onImport(result);
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
      aria-label={t("agents.importCurl")}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-4"
    >
      <Field
        label={t("curl.label")}
        hint={t("curl.hint")}
        error={error}
      >
        {(control) => (
          <Textarea
            ref={textarea}
            mono
            rows={6}
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
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="ghost" aria-label={t("curl.cancel")} onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button variant="secondary" onClick={onImportClick}>
          {t("curl.import")}
        </Button>
      </div>
    </div>
  );
}
