"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => textarea.current?.focus(), []);

  function onImportClick() {
    const result = parseAgentCurl(text);
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
      aria-label="Import from cURL"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-3 rounded-lg border border-line bg-raised p-4"
    >
      <Field
        label="Paste the cURL command"
        hint="In the browser's devtools, right-click the agent's WebSocket request and copy it as cURL. Name and context are not touched."
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
        <Button variant="ghost" aria-label="Cancel import" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={onImportClick}>
          Import
        </Button>
      </div>
    </div>
  );
}
