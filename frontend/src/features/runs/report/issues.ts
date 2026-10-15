import type { Translator } from "@/lib/i18n";
import type { CriterionResult } from "@/features/judgements/types";
import type { PinTone } from "@/ui";
import { clock } from "../format";
import type { RunLevels } from "../types";

/**
 * A transcript turn cited as evidence by failed or partial criteria. Numbered in conversation
 * order; `danger` when a failed criterion cites it, `warn` when only partial ones do.
 */
export type Issue = { n: number; ref: string; tone: Extract<PinTone, "danger" | "warn">; criteria: string[] };

const TURN_REF = /^[AC]\d+$/;

/** The issues of a judgement, one per cited turn; `refsInOrder`: the transcript's refs in order. */
export function collectIssues(criteria: readonly CriterionResult[], refsInOrder: readonly string[]): Issue[] {
  const byRef = new Map<string, { failed: boolean; criteria: string[] }>();
  for (const criterion of criteria) {
    if (criterion.verdict !== "fail" && criterion.verdict !== "partial") continue;
    for (const evidence of criterion.evidence) {
      const ref = evidence.ref.trim();
      if (!TURN_REF.test(ref)) continue;
      const entry = byRef.get(ref) ?? { failed: false, criteria: [] };
      entry.failed ||= criterion.verdict === "fail";
      if (!entry.criteria.includes(criterion.text)) entry.criteria.push(criterion.text);
      byRef.set(ref, entry);
    }
  }
  const issues: Issue[] = [];
  for (const ref of refsInOrder) {
    const entry = byRef.get(ref);
    if (!entry) continue;
    issues.push({ n: issues.length + 1, ref, tone: entry.failed ? "danger" : "warn", criteria: entry.criteria });
  }
  return issues;
}

export type IssuePin = { n: number; ref: string; tone: Issue["tone"]; at: number; label: string };

/** Issues placed on the recording lanes, at the middle of their turn; turns the levels lack are left out. */
export function issuePins(
  t: Translator,
  issues: readonly Issue[],
  levels: Pick<RunLevels, "durationMs" | "turns">,
): IssuePin[] {
  if (levels.durationMs <= 0) return [];
  const turns = new Map(levels.turns.map((turn) => [turn.ref, turn]));
  return issues.flatMap((issue) => {
    const turn = turns.get(issue.ref);
    if (!turn) return [];
    const middle = (turn.startMs + turn.endMs) / 2;
    return [
      {
        n: issue.n,
        ref: issue.ref,
        tone: issue.tone,
        at: Math.min(1, Math.max(0, middle / levels.durationMs)),
        label: t("report.issuePin", { n: issue.n, at: clock(turn.startMs), criteria: issue.criteria.join("; ") }),
      },
    ];
  });
}

/** Passed criteria over the observable ones, and the first missed criterion (a must first). */
export function goalsMet(criteria: readonly CriterionResult[]): { passed: number; observable: number; missed: string | null } {
  const observable = criteria.filter((criterion) => criterion.verdict !== "not_observable");
  const missed = observable.filter((criterion) => criterion.verdict !== "pass");
  const first = missed.find((criterion) => criterion.kind === "must") ?? missed[0];
  return {
    passed: observable.filter((criterion) => criterion.verdict === "pass").length,
    observable: observable.length,
    missed: first?.text ?? null,
  };
}

/** How far apart the judge samples' bands are (max - min); null with fewer than two observed bands. */
export function bandSpread(sampleBands: readonly (number | null)[] | null | undefined): number | null {
  const bands = (sampleBands ?? []).filter((band): band is number => typeof band === "number");
  return bands.length < 2 ? null : Math.max(...bands) - Math.min(...bands);
}

/** Judges disagree when their bands for a criterion are two or more apart. */
export const DISAGREEMENT_SPREAD = 2;

/** `count` evenly spaced clock labels from the start to the end of the run. */
export function timeAxis(durationMs: number, count = 5): string[] {
  if (count <= 1) return count === 1 ? [clock(0)] : [];
  return Array.from({ length: count }, (_, index) => clock((durationMs * index) / (count - 1)));
}
