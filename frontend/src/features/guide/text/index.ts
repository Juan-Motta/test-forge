import type { Locale } from "@/lib/i18n/config";
import { en, type GuideText } from "./en";
import { es } from "./es";

export type { GuideText };

export const GUIDE_TEXT: Record<Locale, GuideText> = { en, es };

/** The guide's short strings in one language. */
export function guideText(locale: Locale): GuideText {
  return GUIDE_TEXT[locale];
}

/** Fills `{name}` placeholders; unknown ones are left as written. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
