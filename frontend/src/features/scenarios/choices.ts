import { withCurrent } from "@/features/connections/voices";


/** Languages the evaluator is most often asked to speak, as BCP 47 tags. */
export const SCENARIO_LOCALES = [
  "es-MX",
  "es-CO",
  "es-AR",
  "es-CL",
  "es-PE",
  "es-US",
  "es-ES",
  "en-US",
  "en-GB",
  "pt-BR",
  "pt-PT",
  "fr-FR",
  "it-IT",
  "de-DE",
] as const;

export type Choice = { value: string; label: string };

/** "Spanish (Mexico) · es-MX", named in the UI's language; the bare tag when it has no name. */
export function localeLabel(tag: string, uiLocale: string): string {
  try {
    const name = new Intl.DisplayNames([uiLocale], { type: "language", languageDisplay: "standard" }).of(tag);
    return name && name !== tag ? `${name} · ${tag}` : tag;
  } catch {
    return tag;
  }
}

/** The offered languages, plus the current one when it is not among them (it stays selectable). */
export function localeChoices(current: string | null | undefined, uiLocale: string): Choice[] {
  const tags: string[] = [...SCENARIO_LOCALES];
  const value = (current ?? "").trim();
  if (value && !tags.includes(value)) tags.push(value);
  return tags.map((tag) => ({ value: tag, label: localeLabel(tag, uiLocale) }));
}

/**
 * The voices offered (those of the chosen connection's kind, for the evaluator mode), plus the
 * current one when it is not among them, so a stored value stays visible (and flagged by
 * validation) until it is changed.
 */
export function voiceChoices(offered: readonly string[], current: string | null | undefined): string[] {
  return withCurrent(offered, current);
}
