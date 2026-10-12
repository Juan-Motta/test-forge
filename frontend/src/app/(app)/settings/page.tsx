import type { Metadata } from "next";
import Link from "next/link";
import { KeyIcon } from "@/features/api-keys/KeyIcon";
import { PageHeader } from "@/features/shell/PageHeader";
import { ConnectionsIcon, ExternalLinkIcon, cn, focusRing } from "@/ui";

export const metadata: Metadata = { title: "Settings" };

const CARD = cn(
  "flex h-full min-h-11 items-start gap-3.5 rounded-xl border border-line bg-panel p-5 text-fg no-underline",
  "transition-colors hover:border-line-strong hover:bg-raised",
  focusRing,
);

export default function Page() {
  return (
    <>
      <PageHeader title="Settings" description="Workspace configuration." />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <Link
            href="/settings/connections"
            className={CARD}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
              <ConnectionsIcon size={20} />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Connections</span>
              <span className="text-sm leading-relaxed text-muted">
                Provider credentials for OpenAI, Azure OpenAI, Azure AI Speech and Langfuse.
              </span>
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/settings/api-keys"
            className={CARD}
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
              <KeyIcon size={20} />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold">API keys</span>
              <span className="text-sm leading-relaxed text-muted">
                Personal keys for CI, scripts and coding agents to use the API.
              </span>
            </span>
          </Link>
        </li>
        <li>
          {/* Served by the backend (Swagger UI), so a plain link, not a client-side one. */}
          <a href="/api/docs" target="_blank" rel="noopener noreferrer" className={CARD}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
              <ExternalLinkIcon size={20} />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-sm font-semibold">
                API docs <span aria-hidden="true">↗</span>
                <span className="sr-only"> (opens in a new tab)</span>
              </span>
              <span className="text-sm leading-relaxed text-muted">
                Every endpoint, its request and response, in Swagger. Use an API key to call them.
              </span>
            </span>
          </a>
        </li>
      </ul>
    </>
  );
}
