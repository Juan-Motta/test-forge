import type { Locale } from "./config";
import { createTranslator } from "./translate";

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export type Format = {
  /** "5 minutes ago", "yesterday", … ("just now" under a minute, either way); "" for a bad date. */
  relativeTime: (iso: string, now?: number) => string;
  /** Full local date and time, for tooltips and `<time>` titles; "" for a bad date. */
  absoluteTime: (iso: string) => string;
  /** US dollars with exactly `fractionDigits` decimals, in the locale's notation. */
  usd: (value: number, fractionDigits: number) => string;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const cache = new Map<Locale, Format>();

/** Locale-aware date and number formatting (`Intl.*`); English output matches the old helpers. */
export function createFormat(locale: Locale): Format {
  const cached = cache.get(locale);
  if (cached) return cached;
  const t = createTranslator(locale);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const absolute = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const format: Format = {
    relativeTime(iso, now = Date.now()) {
      const at = Date.parse(iso);
      if (Number.isNaN(at)) return "";
      const seconds = Math.round((at - now) / 1000);
      for (const [unit, size] of UNITS) {
        if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
      }
      return t("format.justNow");
    },
    absoluteTime(iso) {
      const at = Date.parse(iso);
      return Number.isNaN(at) ? "" : absolute.format(at);
    },
    usd: (value, fractionDigits) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      }).format(value),
    number: (value, options) => new Intl.NumberFormat(locale, options).format(value),
  };
  cache.set(locale, format);
  return format;
}
