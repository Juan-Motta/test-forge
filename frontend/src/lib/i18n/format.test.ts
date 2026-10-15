import { describe, expect, it } from "vitest";
import { createFormat } from "./format";

const NOW = Date.parse("2026-10-15T12:00:00Z");

describe("createFormat", () => {
  it("formats relative time in the locale", () => {
    const en = createFormat("en");
    const es = createFormat("es");
    expect(en.relativeTime("2026-10-15T11:55:00Z", NOW)).toBe("5 minutes ago");
    expect(en.relativeTime("2026-10-14T12:00:00Z", NOW)).toBe("yesterday");
    expect(en.relativeTime("2026-10-15T11:59:40Z", NOW)).toBe("just now");
    expect(en.relativeTime("not a date", NOW)).toBe("");
    expect(es.relativeTime("2026-10-15T11:55:00Z", NOW)).toBe("hace 5 minutos");
    expect(es.relativeTime("2026-10-15T11:59:40Z", NOW)).toBe("justo ahora");
  });

  it("formats absolute dates like the English formatter did", () => {
    const at = "2026-10-15T12:00:00Z";
    const english = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(at));
    expect(createFormat("en").absoluteTime(at)).toBe(english);
    expect(createFormat("es").absoluteTime(at)).toBe(
      new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(Date.parse(at)),
    );
    expect(createFormat("en").absoluteTime("nope")).toBe("");
  });

  it("formats dollars with the locale's separators", () => {
    const en = createFormat("en");
    expect(en.usd(1.234, 2)).toBe("$1.23");
    expect(en.usd(0.0123, 4)).toBe("$0.0123");
    expect(createFormat("es").usd(1.5, 2)).toMatch(/^1,50\sUS\$$/);
  });

  it("formats plain numbers", () => {
    expect(createFormat("en").number(12345.6)).toBe("12,345.6");
    expect(createFormat("es").number(12345.6)).toBe("12.345,6");
  });
});
