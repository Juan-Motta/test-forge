import type { Metadata } from "next";
import type { Locale } from "@/lib/i18n/config";
import { fill, guideText } from "./text";

export type GuideSlug =
  | "overview"
  | "getting-started"
  | "how-it-works"
  | "modules"
  | "scoring"
  | "interruptions-and-evaluator"
  | "automation"
  | "faq";

export type GuideSection = {
  slug: GuideSlug;
  href: string;
  /** Nav label, page heading and metadata title. */
  title: string;
  /** One line under the heading; also the page description. */
  summary: string;
};

/** The guide in reading order; every page links to its neighbours. URLs carry no language. */
const ORDER: readonly { slug: GuideSlug; href: string }[] = [
  { slug: "overview", href: "/guide" },
  { slug: "getting-started", href: "/guide/getting-started" },
  { slug: "how-it-works", href: "/guide/how-it-works" },
  { slug: "modules", href: "/guide/modules" },
  { slug: "scoring", href: "/guide/scoring" },
  { slug: "interruptions-and-evaluator", href: "/guide/interruptions-and-evaluator" },
  { slug: "automation", href: "/guide/automation" },
  { slug: "faq", href: "/guide/faq" },
];

export const GUIDE_SLUGS: readonly GuideSlug[] = ORDER.map((item) => item.slug);

/** Every section in reading order, titled in `locale`. */
export function guideSections(locale: Locale): GuideSection[] {
  const text = guideText(locale).sections;
  return ORDER.map((item) => ({ ...item, ...text[item.slug] }));
}

export function section(slug: GuideSlug, locale: Locale): GuideSection {
  const found = guideSections(locale).find((item) => item.slug === slug);
  if (!found) throw new Error(`Unknown guide section: ${slug}`);
  return found;
}

export function neighbours(slug: GuideSlug, locale: Locale): { previous?: GuideSection; next?: GuideSection } {
  const sections = guideSections(locale);
  const index = sections.findIndex((item) => item.slug === slug);
  return { previous: sections[index - 1], next: sections[index + 1] };
}

/** "<Section> · Duet guide", absolute so the app's "· Duet" template does not apply. */
export function guideMetadata(slug: GuideSlug, locale: Locale): Metadata {
  const { title, summary } = section(slug, locale);
  return { title: { absolute: fill(guideText(locale).meta.title, { title }) }, description: summary };
}
