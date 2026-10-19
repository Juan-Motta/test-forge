"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useT } from "@/lib/i18n";

export type Crumb = {
  label: ReactNode;
  href: string;
  /** Lets a page with unsaved changes veto the navigation (see Next's `Link` `onNavigate`). */
  onNavigate?: ComponentProps<typeof Link>["onNavigate"];
};

/**
 * The path back from a subpage: links to its parent pages, named as in the sidebar. It never
 * includes the current page (the title names it), and top-level pages render none.
 */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  const t = useT();
  return (
    <nav aria-label={t("common.breadcrumb")} data-breadcrumbs className="text-[13px] text-dim">
      {items.map((crumb, index) => (
        <span key={crumb.href}>
          {index > 0 ? <span aria-hidden="true"> / </span> : null}
          <Link href={crumb.href} onNavigate={crumb.onNavigate} className="text-dim hover:text-fg">
            {crumb.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
