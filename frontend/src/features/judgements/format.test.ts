import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n";
import { evidenceSourceLabel, scoreBand, suggestionAreaLabel, suggestionPriorityLabel } from "./format";

const t = createTranslator("en");
const es = createTranslator("es");

describe("scoreBand", () => {
  it("pins the band thresholds: poor below 60, fair from 60, good from 80", () => {
    expect([59, 60, 79, 80].map((score) => scoreBand(t, score).label)).toEqual(["Poor", "Fair", "Fair", "Good"]);
    expect([0, 59.9, 100].map((score) => scoreBand(t, score).label)).toEqual(["Poor", "Poor", "Good"]);
  });
});

describe("judge value labels", () => {
  it("translates the known suggestion areas, priorities and evidence sources", () => {
    expect(suggestionAreaLabel(t, "prompt")).toBe("Prompt");
    expect(suggestionAreaLabel(es, "other")).toBe("Otro");
    expect(suggestionPriorityLabel(t, "high")).toBe("High priority");
    expect(suggestionPriorityLabel(es, "high")).toBe("Prioridad alta");
    expect(evidenceSourceLabel(t, "transcript")).toBe("transcript");
  });

  it("humanizes a value the judge sent that the app does not know, instead of a missing key", () => {
    expect(suggestionAreaLabel(t, "call_routing")).toBe("Call routing");
    expect(suggestionAreaLabel(es, "call_routing")).toBe("Call routing");
    expect(suggestionPriorityLabel(t, "urgent")).toBe("Urgent");
    expect(evidenceSourceLabel(t, "audio_clip")).toBe("audio clip");
  });
});
