import { describe, expect, it } from "vitest";
import { relativeTime } from "./format";

const now = Date.parse("2026-10-09T12:00:00Z");

describe("relativeTime", () => {
  it.each([
    ["2026-10-09T11:59:40Z", "just now"],
    ["2026-10-09T11:55:00Z", "5 minutes ago"],
    ["2026-10-09T09:00:00Z", "3 hours ago"],
    ["2026-10-08T12:00:00Z", "yesterday"],
    ["2026-09-25T12:00:00Z", "2 weeks ago"],
    ["2026-10-09T12:00:30Z", "just now"],
  ])("formats %s as %s", (at, expected) => {
    expect(relativeTime(at, now)).toBe(expected);
  });

  it("returns an empty string for an unparseable date", () => {
    expect(relativeTime("not a date", now)).toBe("");
  });
});
