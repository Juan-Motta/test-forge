import type { Metadata } from "next";
import type { ComponentType } from "react";
import type { Locale } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";
import { GuidePage } from "./GuidePage";
import { guideMetadata, type GuideSlug } from "./sections";

/**
 * One guide route: its metadata and page, in the language of the request (the `app/[lang]` root
 * param, so both languages are prerendered). The body of each language is a server component of its
 * own, so the prose never reaches the browser and only the page language's prose is rendered.
 */
export function guideRoute(slug: GuideSlug, bodies: Record<Locale, ComponentType>) {
  async function generateMetadata(): Promise<Metadata> {
    return guideMetadata(slug, await getLocale());
  }

  async function GuideRoutePage() {
    const locale = await getLocale();
    const Body = bodies[locale];
    return (
      <GuidePage slug={slug} locale={locale}>
        <Body />
      </GuidePage>
    );
  }

  return { generateMetadata, Page: GuideRoutePage };
}
