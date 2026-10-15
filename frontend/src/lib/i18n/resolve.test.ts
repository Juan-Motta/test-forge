import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALE_COOKIE } from "./config";
import { localeFromAcceptLanguage, resolveLocale } from "./resolve";

describe("resolveLocale", () => {
  it("uses the cookie when it names a supported locale", () => {
    expect(resolveLocale({ cookie: "es", acceptLanguage: "en-US,en;q=0.9" })).toBe("es");
    expect(resolveLocale({ cookie: "en", acceptLanguage: "es-MX" })).toBe("en");
  });

  it("ignores an unsupported cookie and falls back to Accept-Language", () => {
    expect(resolveLocale({ cookie: "fr", acceptLanguage: "es-AR,es;q=0.9" })).toBe("es");
  });

  it("falls back to English without a cookie or a supported language", () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({ acceptLanguage: "fr-FR,de;q=0.8" })).toBe("en");
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("names the cookie voice-eval-locale", () => {
    expect(LOCALE_COOKIE).toBe("voice-eval-locale");
  });
});

describe("localeFromAcceptLanguage", () => {
  it("picks the most preferred supported language by quality", () => {
    expect(localeFromAcceptLanguage("fr;q=0.9,es;q=0.8,en;q=0.7")).toBe("es");
    expect(localeFromAcceptLanguage("en;q=0.5,es-MX")).toBe("es");
    expect(localeFromAcceptLanguage("ES-mx")).toBe("es");
  });

  it("skips refused languages and wildcards", () => {
    expect(localeFromAcceptLanguage("es;q=0,en;q=0.3")).toBe("en");
    expect(localeFromAcceptLanguage("*")).toBeNull();
    expect(localeFromAcceptLanguage("")).toBeNull();
    expect(localeFromAcceptLanguage(null)).toBeNull();
  });
});
