import type { Locale } from "./config";
import { MESSAGES, type MessageKey, type PluralKey } from "./messages";

export type MessageVars = Record<string, string | number>;

export type Translator = {
  (key: MessageKey, vars?: MessageVars): string;
  /** The `<key>.one` / `<key>.other` form for `count` (the locale's plural rules), with `{count}`. */
  plural: (key: PluralKey, count: number, vars?: MessageVars) => string;
  locale: Locale;
};

/** Replaces `{name}` placeholders; an unknown one stays visible so a missing variable is noticed. */
export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** A translator bound to one locale. Pure, so server components and tests can use it too. */
export function createTranslator(locale: Locale): Translator {
  const messages = MESSAGES[locale];
  const rules = new Intl.PluralRules(locale);
  const t = ((key: MessageKey, vars?: MessageVars) => interpolate(messages[key], vars)) as Translator;
  t.plural = (key, count, vars) => {
    const form = `${key}.${rules.select(count)}` as MessageKey;
    const template = form in messages ? messages[form] : messages[`${key}.other` as MessageKey];
    return interpolate(template, { ...vars, count });
  };
  t.locale = locale;
  return t;
}
