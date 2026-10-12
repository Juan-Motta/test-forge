import { describe, expect, it } from "vitest";
import { runFixture } from "@/features/runs/testing";
import { isFailedRun, needsReview, runResult } from "./run-result";

describe("run result", () => {
  it("passes a judged run scoring 60 or more", () => {
    const run = runFixture({ judgementStatus: "completed", score: 60 });
    expect(runResult(run)).toMatchObject({ kind: "passed", label: "Passed", tone: "success" });
    expect(needsReview(run)).toBe(false);
  });

  it("flags a judged run under 60, or one whose must criteria failed, for review", () => {
    expect(needsReview(runFixture({ judgementStatus: "completed", score: 59.9 }))).toBe(true);
    const mustFailed = runFixture({ judgementStatus: "completed", score: 90, mustFailed: true });
    expect(needsReview(mustFailed)).toBe(true);
    expect(runResult(mustFailed)).toMatchObject({ kind: "review", label: "Needs review", tone: "evaluator" });
  });

  it("flags a judged run whose must criteria failed even when nothing was scorable", () => {
    const run = runFixture({ judgementStatus: "completed", score: null, mustFailed: true });
    expect(needsReview(run)).toBe(true);
    expect(runResult(run)).toMatchObject({ kind: "review", label: "Needs review" });
  });

  it("only reviews runs whose judgement completed", () => {
    expect(needsReview(runFixture({ judgementStatus: "judging", score: 40, mustFailed: true }))).toBe(false);
  });

  it("never asks to review a run that was not judged", () => {
    expect(needsReview(runFixture({ score: null }))).toBe(false);
    expect(runResult(runFixture({ score: null }))).toMatchObject({ kind: "other", label: "Not judged" });
    expect(runResult(runFixture({ judgementStatus: "collecting_traces" }))).toMatchObject({ label: "Judging…" });
  });

  it("reports failed and interrupted calls as failures, and active ones by status", () => {
    expect(isFailedRun(runFixture({ status: "failed" }))).toBe(true);
    expect(isFailedRun(runFixture({ status: "interrupted" }))).toBe(true);
    expect(isFailedRun(runFixture({ status: "completed" }))).toBe(false);
    expect(runResult(runFixture({ status: "failed" }))).toMatchObject({ kind: "failed", label: "Failed", tone: "danger" });
    expect(runResult(runFixture({ status: "running" }))).toMatchObject({ kind: "active", label: "Running" });
    expect(runResult(runFixture({ status: "cancelled" }))).toMatchObject({ kind: "other", label: "Cancelled" });
  });
});
