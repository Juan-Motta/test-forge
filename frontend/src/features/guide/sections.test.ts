// @vitest-environment node
import { describe, expect, it } from "vitest";
import { GUIDE_SECTIONS, guideMetadata, neighbours, section } from "./sections";

describe("guide sections", () => {
  it("lists the eight sections in reading order, starting at /guide", () => {
    expect(GUIDE_SECTIONS.map((item) => item.href)).toEqual([
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

  it("links each section to the one before and after it", () => {
    expect(neighbours("overview")).toEqual({ previous: undefined, next: section("getting-started") });
    expect(neighbours("scoring")).toEqual({ previous: section("modules"), next: section("interruptions-and-evaluator") });
    expect(neighbours("faq")).toEqual({ previous: section("automation"), next: undefined });
  });

  it("titles every page '<Section> · Duet guide'", () => {
    expect(guideMetadata("scoring").title).toEqual({ absolute: "Scoring · Duet guide" });
    expect(guideMetadata("overview").title).toEqual({ absolute: "Overview · Duet guide" });
    expect(guideMetadata("faq").description).toEqual(section("faq").summary);
  });
});
