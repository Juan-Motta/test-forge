import type { Metadata } from "next";
import Link from "next/link";
import { KeyIcon } from "@/features/api-keys/KeyIcon";
import { PageHeader } from "@/features/shell/PageHeader";
import { ConnectionsIcon, cn, focusRing } from "@/ui";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return (
    <>
      <PageHeader title="Settings" description="Workspace configuration." />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <li>
          <Link
            href="/settings/connections"
            className={cn(
              "flex min-h-11 items-start gap-3.5 rounded-xl border border-line bg-panel p-5 text-fg no-underline",
              "transition-colors hover:border-line-strong hover:bg-raised",
              focusRing,
            )}
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
            className={cn(
              "flex min-h-11 items-start gap-3.5 rounded-xl border border-line bg-panel p-5 text-fg no-underline",
              "transition-colors hover:border-line-strong hover:bg-raised",
              focusRing,
            )}
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
      </ul>
    </>
  );
}
