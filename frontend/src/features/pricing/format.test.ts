import { describe, expect, it } from "vitest";
import { formatUsd, runCostLabel } from "./format";
import { runCostFixture } from "./testing";

describe("formatUsd", () => {
  it("shows cents for a dollar or more and four decimals below", () => {
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(0.4435)).toBe("$0.4435");
    expect(formatUsd(0.00004)).toBe("<$0.0001");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("shows a dash when there is no amount", () => {
    expect(formatUsd(null)).toBe("—");
    expect(formatUsd(undefined)).toBe("—");
  });
});

describe("runCostLabel", () => {
  it("is the approximate total, marked when incomplete", () => {
    expect(runCostLabel(runCostFixture())).toBe("≈ $0.4435");
    expect(runCostLabel(runCostFixture({ complete: false }))).toBe("≈ $0.4435+");
    expect(runCostLabel(null)).toBe("—");
    expect(runCostLabel(undefined)).toBe("—");
  });
});
