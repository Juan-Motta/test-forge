import { describe, expect, it } from "vitest";
import { createFormat } from "./format";

const { relativeTime } = createFormat("en");
const es = createFormat("es");

const now = Date.parse("2026-10-09T12:00:00Z");

describe("relativeTime (English)", () => {
  it.each([
    ["2026-10-09T11:59:40Z", "just now"],
    ["2026-10-09T11:55:00Z", "5 minutes ago"],
    ["2026-10-09T09:00:00Z", "3 hours ago"],
    ["2026-10-08T12:00:00Z", "yesterday"],
    ["2026-09-25T12:00:00Z", "2 weeks ago"],
    ["2026-10-09T12:00:30Z", "just now"],
    ["2026-10-09T15:00:00Z", "in 3 hours"],
    ["2026-10-10T12:00:00Z", "tomorrow"],
  ])("formats %s as %s", (at, expected) => {
    expect(relativeTime(at, now)).toBe(expected);
  });

  it("returns an empty string for an unparseable date", () => {
    expect(relativeTime("not a date", now)).toBe("");
  });
});

describe("relativeTime (Spanish)", () => {
  it.each([
    ["2026-10-09T11:59:40Z", "justo ahora"],
    ["2026-10-09T11:55:00Z", "hace 5 minutos"],
    ["2026-10-09T09:00:00Z", "hace 3 horas"],
    ["2026-10-08T12:00:00Z", "ayer"],
    ["2026-09-25T12:00:00Z", "hace 2 semanas"],
    ["2026-10-09T12:00:30Z", "justo ahora"],
    ["2026-10-09T15:00:00Z", "dentro de 3 horas"],
  ])("formats %s as %s", (at, expected) => {
    expect(es.relativeTime(at, now)).toBe(expected);
  });

  it("returns an empty string for an unparseable date", () => {
    expect(es.relativeTime("not a date", now)).toBe("");
  });
});
