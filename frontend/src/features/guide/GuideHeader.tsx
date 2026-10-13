import Link from "next/link";
import { Brand } from "@/features/shell/Brand";
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
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5 lg:px-8">
        <Link href="/guide" aria-label="Duet guide home" className={cn("flex items-center gap-1 rounded-lg text-fg no-underline hover:text-fg", focusRing)}>
          <Brand />
          <span className="rounded-full border border-field-line px-2 py-0.5 text-xs font-medium text-muted">Guide</span>
        </Link>
        <nav aria-label="Guide links" className="flex flex-wrap items-center gap-2">
          {/* Served by the backend (Swagger UI), so a plain link, not a client-side one. */}
          <a
            href="/api/docs"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonClasses("ghost", "min-h-10 px-3 no-underline"))}
          >
            <ExternalLinkIcon size={16} />
            API reference (Swagger)
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <Link href="/" className={buttonClasses("primary", "min-h-10 px-3.5 no-underline hover:text-on-evaluator")}>
            Open the app
          </Link>
        </nav>
      </div>
    </header>
  );
}
