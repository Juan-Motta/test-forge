import Link from "next/link";
import { ChevronDownIcon, cn, focusRing } from "@/ui";
import type { Locale } from "@/lib/i18n/config";
import { guideSections, section, type GuideSlug } from "./sections";
import { guideText } from "./text";

function SectionLinks({ current, locale }: { current: GuideSlug; locale: Locale }) {
  return (
    <ol className="flex flex-col gap-0.5">
      {guideSections(locale).map((item, index) => {
        const active = item.slug === current;
        return (
          <li key={item.slug}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm no-underline transition-colors",
                focusRing,
                active ? "bg-active font-medium text-fg hover:text-fg" : "text-muted hover:bg-active/60 hover:text-fg",
              )}
            >
              <span aria-hidden="true" className={cn("w-4 font-mono text-[11px]", active ? "text-evaluator-fg" : "text-dim")}>
                {index + 1}
              </span>
              {item.title}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The section list: a sticky column on wide screens, a collapsible menu on phones. Only one of
 * the two is displayed at a time, so assistive tech meets a single "Guide sections" landmark.
 */
export function GuideNav({ current, locale }: { current: GuideSlug; locale: Locale }) {
  const { nav } = guideText(locale);
  return (
    <>
      <details className="group rounded-xl border border-line bg-panel lg:hidden">
        <summary
          className={cn(
            "flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 text-sm [&::-webkit-details-marker]:hidden",
            focusRing,
          )}
        >
          <span>
            <span className="text-dim">{nav.current}</span>
            <span className="font-medium text-fg">{section(current, locale).title}</span>
          </span>
          <ChevronDownIcon size={16} className="text-muted transition-transform group-open:rotate-180" />
        </summary>
        <nav aria-label={nav.label} className="border-t border-line p-2">
          <SectionLinks current={current} locale={locale} />
        </nav>
      </details>
      <aside className="hidden w-60 shrink-0 lg:block">
        <nav aria-label={nav.label} className="sticky top-24 flex flex-col gap-3">
          <span className="px-3 text-xs font-medium tracking-[0.06em] text-dim uppercase">{nav.heading}</span>
          <SectionLinks current={current} locale={locale} />
        </nav>
      </aside>
    </>
  );
}
