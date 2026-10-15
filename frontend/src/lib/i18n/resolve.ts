import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

/**
 * The supported locale the browser prefers most, from an `Accept-Language` header
 * ("es-MX,es;q=0.9,en;q=0.8"); null when it names none (or only `*`).
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { language: tag.trim().split("-")[0].toLowerCase(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.quality > 0)
    // Highest quality first; equal qualities keep the header's order.
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  return ranked.find((entry) => isLocale(entry.language))?.language as Locale | undefined ?? null;
}

/** The page language: the remembered choice, else the browser's preference, else English. */
export function resolveLocale(input: { cookie?: string | null; acceptLanguage?: string | null }): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return localeFromAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}
