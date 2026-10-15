import Link from "next/link";
import { Brand } from "@/features/shell/Brand";
import { ThemeControl } from "@/features/theme/ThemeControl";
import { ExternalLinkIcon, buttonClasses, cn, focusRing } from "@/ui";

/** Sticky top bar of the public guide: brand, a way into the app and the technical reference. */
export function GuideHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-ground/95 backdrop-blur">
      <a
        href="#guide-content"
        className={cn(
          "sr-only rounded-md bg-evaluator px-3 py-2 text-sm font-semibold text-on-evaluator focus:not-sr-only focus:absolute focus:top-2 focus:left-2",
          focusRing,
        )}
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 lg:px-8">
        <Link href="/guide" aria-label="Duet guide home" className={cn("flex items-center gap-1 rounded-lg text-fg no-underline hover:text-fg", focusRing)}>
          <Brand />
          <span className="hidden rounded-full border border-field-line px-2 py-0.5 text-xs font-medium text-muted sm:inline">Guide</span>
        </Link>
        {/* Room for it from tablet width up; on phones the app sidebar and the sign-in page offer it. */}
        <div className="ml-auto hidden md:block">
          <ThemeControl />
        </div>
        <nav aria-label="Guide links" className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Served by the backend (Swagger UI), so a plain link, not a client-side one. */}
          <a
            href="/api/docs"
            aria-label="API reference (Swagger) (opens in a new tab)"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonClasses("ghost", "min-h-10 px-3 no-underline"))}
          >
            <ExternalLinkIcon size={16} />
            {/* Short labels on phones keep the sticky bar to one row; aria-label keeps the full name. */}
            API<span className="hidden sm:inline">&nbsp;reference (Swagger)</span>
          </a>
          <Link href="/" aria-label="Open the app" className={buttonClasses("primary", "min-h-10 px-3.5 no-underline hover:text-on-evaluator")}>
            Open<span className="hidden sm:inline">&nbsp;the</span> app
          </Link>
        </nav>
      </div>
    </header>
  );
}
