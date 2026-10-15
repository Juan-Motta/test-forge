import { describe, expect, it } from "vitest";
import { createTranslator } from "./translate";

describe("createTranslator", () => {
  it("returns the message of the locale", () => {
    expect(createTranslator("en")("theme.light")).toBe("Light");
    expect(createTranslator("es")("theme.light")).toBe("Claro");
  });

  it("interpolates {name} placeholders and keeps unknown ones", () => {
    const t = createTranslator("en");
    expect(t("shell.environment", { label: "staging" })).toBe("Environment · staging");
    expect(t("shell.environment")).toBe("Environment · {label}");
  });

  it("picks the plural form by count, with the count available as {count}", () => {
    const en = createTranslator("en");
    const es = createTranslator("es");
    expect(en.plural("nav.activeRuns", 1, { label: "Live" })).toBe("Live (1 active)");
    expect(en.plural("nav.activeRuns", 3, { label: "Live" })).toBe("Live (3 active)");
    expect(es.plural("nav.activeRuns", 1, { label: "En vivo" })).toBe("En vivo (1 activa)");
    expect(es.plural("nav.activeRuns", 2, { label: "En vivo" })).toBe("En vivo (2 activas)");
  });
});
