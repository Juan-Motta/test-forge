"use client";

import Link from "next/link";
import { Brand } from "@/features/shell/Brand";
import { LanguageControl } from "@/features/shell/LanguageControl";
import { ThemeControl } from "@/features/theme/ThemeControl";
import { useT } from "@/lib/i18n";
import { ExternalLinkIcon, buttonClasses, cn, focusRing } from "@/ui";

/** Sticky top bar of the public guide: brand, a way into the app and the technical reference. */
export function GuideHeader() {
  const t = useT();
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ground/95 backdrop-blur">
      <a
        href="#guide-content"
        className={cn(
          "sr-only rounded-md bg-evaluator px-3 py-2 text-sm font-semibold text-on-evaluator focus:not-sr-only focus:absolute focus:top-2 focus:left-2",
          focusRing,
        )}
      >
        {t("guideHeader.skip")}
      </a>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 lg:px-8">
        <Link href="/guide" aria-label={t("guideHeader.home")} className={cn("flex items-center gap-1 rounded-lg text-fg no-underline hover:text-fg", focusRing)}>
          <Brand />
          <span className="hidden rounded-full border border-field-line px-2 py-0.5 text-xs font-medium text-muted sm:inline">
            {t("guideHeader.badge")}
          </span>
        </Link>
        {/* Room for them from tablet width up; on phones the app's Settings and the sign-in page offer them. */}
        <div className="ml-auto hidden items-center gap-2 md:flex">
          <ThemeControl />
          <LanguageControl />
        </div>
        <nav aria-label={t("guideHeader.links")} className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Served by the backend (Swagger UI), so a plain link, not a client-side one. */}
          <a
            href="/api/docs"
            aria-label={t("guideHeader.apiNewTab")}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonClasses("ghost", "min-h-10 px-3 no-underline"))}
          >
            <ExternalLinkIcon size={16} />
            {/* Short labels on phones keep the sticky bar to one row; aria-label keeps the full name. */}
            {/* One text node per label: the button's flex gap would space out split pieces. */}
            <span className="sm:hidden">{t("guideHeader.apiShort")}</span>
            <span className="hidden sm:inline">{t("guideHeader.api")}</span>
          </a>
          <Link href="/" aria-label={t("guideHeader.openApp")} className={buttonClasses("primary", "min-h-10 px-3.5 no-underline hover:text-on-evaluator")}>
            <span className="sm:hidden">{t("guideHeader.openAppShort")}</span>
            <span className="hidden sm:inline">{t("guideHeader.openApp")}</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
