import Link from "next/link";
import type { ReactNode } from "react";
import { cn, focusRing } from "@/ui";
import { GuideNav } from "./GuideNav";
import { neighbours, section, type GuideSlug } from "./sections";

/** One guide section: the section nav, its heading and summary, the content and prev/next links. */
export function GuidePage({ slug, children }: { slug: GuideSlug; children: ReactNode }) {
  const { title, summary } = section(slug);
  const { previous, next } = neighbours(slug);
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row lg:gap-12 lg:px-8 lg:py-10">
      <GuideNav current={slug} />
      <main id="guide-content" tabIndex={-1} className="flex min-w-0 max-w-3xl flex-1 flex-col gap-5 focus:outline-none">
        <header className="flex flex-col gap-2 border-b border-line pb-5">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-fg sm:text-[32px]">{title}</h1>
          <p className="text-[15px] leading-7 text-muted">{summary}</p>
        </header>
        {children}
        <nav aria-label="Previous and next section" className="mt-6 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
          {previous ? (
            <Pager href={previous.href} direction="Previous" title={previous.title} />
          ) : (
            <span aria-hidden="true" />
          )}
          {next ? <Pager href={next.href} direction="Next" title={next.title} className="sm:text-right" /> : null}
        </nav>
      </main>
    </div>
  );
}

function Pager({ href, direction, title, className }: { href: string; direction: string; title: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label={`${direction}: ${title}`}
      className={cn(
        "flex flex-col gap-1 rounded-xl border border-line bg-panel px-4 py-3 no-underline transition-colors hover:border-line-strong hover:bg-raised",
        focusRing,
        className,
      )}
    >
      <span className="text-xs text-dim">{direction === "Previous" ? "← Previous" : "Next →"}</span>
      <span className="text-[15px] font-medium text-fg">{title}</span>
    </Link>
  );
}
