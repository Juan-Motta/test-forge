import Link from "next/link";
import type { ReactNode } from "react";
import { cn, focusRing } from "@/ui";
import type { Locale } from "@/lib/i18n/config";
import { GuideNav } from "./GuideNav";
import { neighbours, section, type GuideSlug } from "./sections";
import { fill, guideText } from "./text";

/** One guide section: the section nav, its heading and summary, the content and prev/next links. */
export function GuidePage({ slug, locale, children }: { slug: GuideSlug; locale: Locale; children: ReactNode }) {
  const { title, summary } = section(slug, locale);
  const { previous, next } = neighbours(slug, locale);
  const { pager } = guideText(locale);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-12 lg:px-8 lg:py-10">
      <GuideNav current={slug} locale={locale} />
      <main id="guide-content" tabIndex={-1} className="flex min-w-0 max-w-3xl flex-1 flex-col gap-5 focus:outline-none">
        <header className="flex flex-col gap-2 border-b border-line pb-5">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-fg sm:text-[32px]">{title}</h1>
          <p className="text-[15px] leading-7 text-muted">{summary}</p>
        </header>
        {children}
        <nav aria-label={pager.label} className="mt-6 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
          {previous ? (
            <Pager href={previous.href} label={fill(pager.previousLink, { title: previous.title })} direction={pager.previous} title={previous.title} />
          ) : (
            <span aria-hidden="true" />
          )}
          {next ? (
            <Pager
              href={next.href}
              label={fill(pager.nextLink, { title: next.title })}
              direction={pager.next}
              title={next.title}
              className="sm:text-right"
            />
          ) : null}
        </nav>
      </main>
    </div>
  );
}

type PagerProps = { href: string; label: string; direction: string; title: string; className?: string };

function Pager({ href, label, direction, title, className }: PagerProps) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "flex flex-col gap-1 rounded-xl border border-line bg-panel px-4 py-3 no-underline transition-colors hover:border-line-strong hover:bg-raised",
        focusRing,
        className,
      )}
    >
      <span className="text-xs text-dim">{direction}</span>
      <span className="text-[15px] font-medium text-fg">{title}</span>
    </Link>
  );
}
