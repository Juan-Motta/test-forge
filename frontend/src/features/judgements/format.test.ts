import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n";
import { scoreBand } from "./format";

const t = createTranslator("en");

describe("scoreBand", () => {
  it("pins the band thresholds: poor below 60, fair from 60, good from 80", () => {
    expect([59, 60, 79, 80].map((score) => scoreBand(t, score).label)).toEqual(["Poor", "Fair", "Fair", "Good"]);
    expect([0, 59.9, 100].map((score) => scoreBand(t, score).label)).toEqual(["Poor", "Poor", "Good"]);
  });
});
