import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { KeyIcon } from "@/features/api-keys/KeyIcon";
import { LanguageControl } from "@/features/shell/LanguageControl";
import { ReplyFormatControl } from "@/features/shell/ReplyFormatControl";
import { PageHeader } from "@/features/shell/PageHeader";
import { ThemeControl } from "@/features/theme/ThemeControl";
import { T, type MessageKey } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { ConnectionsIcon, ExternalLinkIcon, PriceIcon, cn, focusRing } from "@/ui";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: t("nav.settings") };
}

const CARD = cn(
  "flex h-full min-h-11 items-start gap-3.5 rounded-xl border border-line bg-panel p-5 text-fg no-underline",
  "transition-colors hover:border-line-strong hover:bg-raised",
  focusRing,
);

const SECTION_TITLE = "text-base font-semibold text-fg";

/** One preference: its name and what it does, with its (client) switch beside it. */
function Preference({ title, description, children }: { title: MessageKey; description: MessageKey; children: ReactNode }) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-fg">
          <T k={title} />
        </span>
        <span className="text-sm leading-relaxed text-muted">
          <T k={description} />
        </span>
      </span>
      <span className="shrink-0">{children}</span>
    </li>
  );
}

export default function Page() {
  return (
    <>
      <PageHeader title={<T k="nav.settings" />} description={<T k="settings.description" />} />
      <section aria-labelledby="settings-preferences" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="settings-preferences" className={SECTION_TITLE}>
            <T k="settings.preferences" />
          </h2>
          <p className="text-sm text-muted">
            <T k="settings.preferencesDescription" />
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-line rounded-xl border border-line bg-panel">
          <Preference title="theme.label" description="settings.theme">
            <ThemeControl />
          </Preference>
          <Preference title="language.label" description="settings.language">
            <LanguageControl />
          </Preference>
          <Preference title="replyFormat.label" description="settings.replyFormat">
            <ReplyFormatControl />
          </Preference>
        </ul>
      </section>
      <section aria-labelledby="settings-workspace" className="mt-8 flex flex-col gap-3">
        <h2 id="settings-workspace" className={SECTION_TITLE}>
          <T k="settings.workspace" />
        </h2>
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
                <span className="text-sm font-semibold">
                  <T k="nav.connections" />
                </span>
                <span className="text-sm leading-relaxed text-muted">
                  <T k="settings.connections" />
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
                <span className="text-sm font-semibold">
                  <T k="nav.apiKeys" />
                </span>
                <span className="text-sm leading-relaxed text-muted">
                  <T k="settings.apiKeys" />
                </span>
              </span>
            </Link>
          </li>
          <li>
            <Link href="/settings/pricing" className={CARD}>
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
                <PriceIcon size={20} />
              </span>
              <span className="flex flex-col gap-1">
                <span className="text-sm font-semibold">
                  <T k="prices.title" />
                </span>
                <span className="text-sm leading-relaxed text-muted">
                  <T k="settings.prices" />
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
                  <T k="nav.apiDocs" />
                  <span className="sr-only">
                    {" "}
                    <T k="common.newTab" />
                  </span>
                </span>
                <span className="text-sm leading-relaxed text-muted">
                  <T k="settings.apiDocs" />
                </span>
              </span>
            </a>
          </li>
        </ul>
      </section>
    </>
  );
}
