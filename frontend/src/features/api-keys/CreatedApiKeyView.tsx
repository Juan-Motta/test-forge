"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { AlertIcon, Button, CheckIcon, CopyIcon, Input } from "@/ui";
import { curlExample } from "./format";

type CreatedApiKeyViewProps = {
  secret: string;
  /** This deployment's origin, for the curl example. */
  origin: string;
  onDone: () => void;
};

type CopyState = "idle" | "copied" | "failed";

/** The one time the full key is visible: copy it, see how to use it, then close for good. */
export function CreatedApiKeyView({ secret, origin, onDone }: CreatedApiKeyViewProps) {
  const t = useT();
  const id = useId();
  const keyRef = useRef<HTMLInputElement>(null);
  const [copy, setCopy] = useState<CopyState>("idle");

  // The create form (and its focused button) is gone: put focus on the key, selected.
  useEffect(() => {
    keyRef.current?.focus();
    keyRef.current?.select();
  }, []);

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Not an Alert: its role="status" would compete with the copy announcement below. */}
      <p className="flex items-start gap-3 rounded-lg border border-line-strong bg-raised px-3.5 py-3 text-sm">
        <AlertIcon size={16} className="mt-0.5 shrink-0" />
        <span>
          <strong className="font-semibold">{t("apiKeys.onceTitle")}</strong> {t("apiKeys.onceBody")}
        </span>
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-xs font-medium text-muted">
          {t("apiKeys.apiKey")}
        </label>
        <div className="flex gap-2">
          <Input ref={keyRef} id={id} mono readOnly value={secret} className="min-w-0 flex-1" />
          <Button
            variant="secondary"
            icon={copy === "copied" ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            onClick={copyKey}
          >
            {t("ui.copy")}
          </Button>
        </div>
        <p role="status" className="text-xs text-dim">
          {copy === "copied" ? t("ui.copied") : copy === "failed" ? t("apiKeys.copyFailed") : ""}
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted">{t("apiKeys.tryIt")}</p>
        <pre className="overflow-x-auto rounded-lg border border-line bg-raised px-3 py-2.5 font-mono text-xs whitespace-pre-wrap break-all">
          <code>{curlExample(secret, origin)}</code>
        </pre>
      </div>
      <div className="flex justify-end">
        <Button onClick={onDone}>{t("apiKeys.done")}</Button>
      </div>
    </div>
  );
}
