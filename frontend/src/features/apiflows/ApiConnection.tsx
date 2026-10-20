"use client";

import { useT } from "@/lib/i18n";
import type { Api } from "./types";
import { SecretChip } from "./SecretChip";
import { useSecretReveal } from "./use-secret-reveal";

/** Under the API's description: its base URL, then one chip per secret with its eye toggle. */
export function ApiConnection({ api }: { api: Pick<Api, "id" | "baseUrl" | "secrets"> }) {
  const t = useT();
  const reveal = useSecretReveal(api.id);
  return (
    <div className="flex flex-col gap-1">
      <ul aria-label={t("apis.connection")} className="flex flex-wrap items-center gap-1.5">
        <li>
          <span className="inline-flex max-w-full rounded-full border border-field-line bg-field px-2.5 py-0.5 font-mono text-xs break-all text-fg">
            {api.baseUrl}
          </span>
        </li>
        {api.secrets.map((secret) => (
          <li key={secret.name}>
            <SecretChip
              name={secret.name}
              hint={secret.hint}
              value={reveal.shown[secret.name]}
              pending={reveal.pending.has(secret.name)}
              onToggle={() => void reveal.toggle(secret.name)}
            />
          </li>
        ))}
      </ul>
      {reveal.error ? (
        <p role="alert" className="text-xs text-danger-fg">
          {t("apis.revealFailed", { error: reveal.error })}
        </p>
      ) : null}
    </div>
  );
}
