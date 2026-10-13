import type { Metadata } from "next";

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

/** The guide in reading order; every page links to its neighbours. */
export const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    slug: "overview",
    href: "/guide",
    title: "Overview",
    summary: "What Duet is, who it is for, and the idea behind it: a simulated caller phones your voice agent.",
  },
  {
    slug: "getting-started",
    href: "/guide/getting-started",
    title: "Getting started",
    summary: "From an empty workspace to your first judged call, step by step.",
  },
  {
    slug: "how-it-works",
    href: "/guide/how-it-works",
    title: "How it works",
    summary: "What happens between pressing Launch and reading the report, and the states a run goes through.",
  },
  {
    slug: "modules",
    href: "/guide/modules",
    title: "The modules",
    summary: "Every screen of the app: what it is for, its key fields and a few tips.",
  },
  {
    slug: "scoring",
    href: "/guide/scoring",
    title: "Scoring",
    summary: "How the judge turns a call into a score, a verdict and concrete suggestions.",
  },
  {
    slug: "interruptions-and-evaluator",
    href: "/guide/interruptions-and-evaluator",
    title: "Interruptions and the evaluator",
    summary: "Barge-ins, the two ways the evaluator can speak, its models and when it hangs up.",
  },
  {
    slug: "automation",
    href: "/guide/automation",
    title: "Automation",
    summary: "Drive Duet from scripts, CI or an AI agent with API keys, the Swagger reference and the agent skill.",
  },
  {
    slug: "faq",
    href: "/guide/faq",
    title: "Troubleshooting & FAQ",
    summary: "Common problems and their fixes, frequent questions, and a glossary of the terms used in Duet.",
  },
];

export function section(slug: GuideSlug): GuideSection {
  const found = GUIDE_SECTIONS.find((item) => item.slug === slug);
  if (!found) throw new Error(`Unknown guide section: ${slug}`);
  return found;
}

export function neighbours(slug: GuideSlug): { previous?: GuideSection; next?: GuideSection } {
  const index = GUIDE_SECTIONS.findIndex((item) => item.slug === slug);
  return { previous: GUIDE_SECTIONS[index - 1], next: GUIDE_SECTIONS[index + 1] };
}

/** "<Section> · Duet guide", absolute so the app's "· Duet" template does not apply. */
export function guideMetadata(slug: GuideSlug): Metadata {
  const { title, summary } = section(slug);
  return { title: { absolute: `${title} · Duet guide` }, description: summary };
}
