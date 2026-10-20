import { describe, expect, it } from "vitest";
import { flowRunSummaryFixture } from "@/features/apiflows/testing";
import { flowRunHref, mergeRuns } from "./run-entries";
import { runFixture } from "./testing";

describe("mergeRuns", () => {
  it("interleaves agent and flow runs newest first", () => {
    const merged = mergeRuns(
      [runFixture({ id: "r-new", createdAt: "2026-10-20T12:00:00Z" }), runFixture({ id: "r-old", createdAt: "2026-10-01T12:00:00Z" })],
      [flowRunSummaryFixture({ id: "f-mid", createdAt: "2026-10-10T12:00:00Z" })],
    );

    expect(merged.map((entry) => `${entry.kind}:${entry.run.id}`)).toEqual(["agent:r-new", "flow:f-mid", "agent:r-old"]);
  });
});

describe("flowRunHref", () => {
  it("opens the run view of the flow inside its API", () => {
    expect(flowRunHref({ id: "run 1", apiId: "api-shop", flowId: "f-products" })).toBe(
      "/apis/api-shop?flow=f-products&run=run%201",
    );
  });
});
