import { describe, expect, it } from "vitest";
import { createFormat } from "@/lib/i18n";
import { formatUsd, runCostLabel } from "./format";
import { runCostFixture } from "./testing";

const format = createFormat("en");

describe("formatUsd", () => {
  it("shows cents for a dollar or more and four decimals below", () => {
    expect(formatUsd(format, 12.345)).toBe("$12.35");
    expect(formatUsd(format, 1)).toBe("$1.00");
    expect(formatUsd(format, 0.4435)).toBe("$0.4435");
    expect(formatUsd(format, 0.00004)).toBe("<$0.0001");
    expect(formatUsd(format, 0)).toBe("$0.00");
  });

  it("shows a dash when there is no amount", () => {
    expect(formatUsd(format, null)).toBe("—");
    expect(formatUsd(format, undefined)).toBe("—");
  });
});

describe("runCostLabel", () => {
  it("is the approximate total, marked when incomplete", () => {
    expect(runCostLabel(format, runCostFixture())).toBe("≈ $0.4435");
    expect(runCostLabel(format, runCostFixture({ complete: false }))).toBe("≈ $0.4435+");
    expect(runCostLabel(format, null)).toBe("—");
    expect(runCostLabel(format, undefined)).toBe("—");
  });
});
