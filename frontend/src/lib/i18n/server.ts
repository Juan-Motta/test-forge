// Server-only helpers: `next/root-params` fails the build if a client component imports this file.
import { lang } from "next/root-params";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";
import { createTranslator, type Translator } from "./translate";

/** The page language of this request, from the `app/[lang]` root param the proxy rewrote to. */
export async function getLocale(): Promise<Locale> {
  const locale = await lang();
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

/** A translator for server components and `generateMetadata` (which cannot use hooks). */
export async function getTranslator(): Promise<Translator> {
  return createTranslator(await getLocale());
}
