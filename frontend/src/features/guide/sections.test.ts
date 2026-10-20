// @vitest-environment node
import { describe, expect, it } from "vitest";
import { guideMetadata, guideSections, neighbours, section } from "./sections";

describe("guide sections", () => {
  it("lists the eight sections in reading order, starting at /guide", () => {
    expect(guideSections("en").map((item) => item.href)).toEqual([
      "/guide",
      "/guide/getting-started",
      "/guide/how-it-works",
      "/guide/modules",
      "/guide/scoring",
      "/guide/interruptions-and-evaluator",
      "/guide/automation",
      "/guide/faq",
    ]);
  });

  it("keeps the same URLs in Spanish and translates titles and summaries", () => {
    const english = guideSections("en");
    const spanish = guideSections("es");
    expect(spanish.map((item) => item.href)).toEqual(english.map((item) => item.href));
    expect(section("scoring", "es").title).toBe("Puntuación");
    spanish.forEach((item, index) => {
      expect(item.title).not.toBe(english[index].title);
      expect(item.summary).not.toBe(english[index].summary);
    });
  });

  it("links each section to the one before and after it", () => {
    expect(neighbours("overview", "en")).toEqual({ previous: undefined, next: section("getting-started", "en") });
    expect(neighbours("scoring", "en")).toEqual({
      previous: section("modules", "en"),
      next: section("interruptions-and-evaluator", "en"),
    });
    expect(neighbours("faq", "es")).toEqual({ previous: section("automation", "es"), next: undefined });
  });

  it("titles every page '<Section> · TestForge guide' in the page language", () => {
    expect(guideMetadata("scoring", "en").title).toEqual({ absolute: "Scoring · TestForge guide" });
    expect(guideMetadata("overview", "en").title).toEqual({ absolute: "Overview · TestForge guide" });
    expect(guideMetadata("faq", "en").description).toEqual(section("faq", "en").summary);
    expect(guideMetadata("scoring", "es").title).toEqual({ absolute: "Puntuación · Guía de TestForge" });
    expect(guideMetadata("faq", "es").description).toEqual(section("faq", "es").summary);
  });
});
