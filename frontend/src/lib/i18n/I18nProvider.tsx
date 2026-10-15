"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./config";
import { writeLocaleCookie } from "./cookie";
import { createFormat, type Format } from "./format";
import { createTranslator, type MessageVars, type Translator } from "./translate";
import type { MessageKey } from "./messages";

type I18nValue = { locale: Locale; t: Translator; format: Format; setLocale: (locale: Locale) => void };

// Without a provider (isolated component tests) everything reads English and switching is inert.
const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  t: createTranslator(DEFAULT_LOCALE),
  format: createFormat(DEFAULT_LOCALE),
  setLocale: () => {},
});

type I18nProviderProps = {
  /** The language the server rendered in (cookie, else Accept-Language, else English). */
  locale: Locale;
  /** Runs after a switch, e.g. to re-render server components in the new language. */
  onLocaleChange?: (locale: Locale) => void;
  children: ReactNode;
};

/** Gives client components the page language, its messages and its formatting. */
export function I18nProvider({ locale: serverLocale, onLocaleChange, children }: I18nProviderProps) {
  const [locale, setLocaleState] = useState(serverLocale);
  // A new server locale (after a refresh) wins over the local state.
  const [lastServerLocale, setLastServerLocale] = useState(serverLocale);
  if (serverLocale !== lastServerLocale) {
    setLastServerLocale(serverLocale);
    setLocaleState(serverLocale);
  }

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      t: createTranslator(locale),
      format: createFormat(locale),
      setLocale(next) {
        writeLocaleCookie(next);
        document.documentElement.lang = next;
        setLocaleState(next);
        onLocaleChange?.(next);
      },
    }),
    [locale, onLocaleChange],
  );
  return <I18nContext value={value}>{children}</I18nContext>;
}

/** `t("key", { name })` and `t.plural("key", count)` in the page language. */
export function useT(): Translator {
  return useContext(I18nContext).t;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

/** Switches the page language and remembers it (cookie) for the server. */
export function useSetLocale(): (locale: Locale) => void {
  return useContext(I18nContext).setLocale;
}

/** Dates, relative times and numbers in the page language. */
export function useFormat(): Format {
  return useContext(I18nContext).format;
}

/** A translated text node, for server components (which cannot call hooks). */
export function T({ k, vars }: { k: MessageKey; vars?: MessageVars }) {
  return useT()(k, vars);
}
