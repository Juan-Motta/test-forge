# Feature: judge-v2

Branch: `feat/judge-v2` (chained on `feat/review-followups`). Delivery: feature-branch-chain.

## Objective
Make the judge's scores stable and harder to inflate by porting the scoring ideas of the user's
`vivi-evaluations` system (KSG-GTAI/vivi-evaluations, backend/services/evaluations) while keeping our
per-scenario weighted criteria.

## Why
The same run (ec3633f4) scored 79 and then 88. In vivi-evaluations, flips came mostly from evidence
gaps and ambiguous rubric forks; anchored bands, worst-case caps and deterministic gating cut cells
with spread ≥2 from 8/36 to 1/36. The user approved applying the five improvements (2026-10-11).

## Scope
1. Anchored bands: per criterion the judge picks an integer band 1–5 with fixed anchors; code maps
   it to a fixed score (5→100, 4→90, 3→70, 2→50, 1→25) and derives the verdict (4–5 pass, 3 partial,
   1–2 fail). No free 0–100 score from the model.
2. Worst-case caps: closed failure-tag list; a "capping" tag (fabricated information, wrong
   information, explicit instruction ignored, unsafe/policy violation) caps the criterion at band 2,
   enforced in code as well as stated in the prompt. No averaging good and bad.
3. Rationale before score: schema order per criterion = evidence → reasoning → band → failure tags;
   closed failure-tag list (max 5 per criterion, none on band 5); summary tags aggregated per run.
4. Deterministic not-observable: code decides before/after the model, with a typed reason —
   `traces_unavailable` (trace criterion, no traces), `no_timing_data` (timing criterion, no turn
   timings), `judge_marked_unobservable` (model says the evidence does not cover it),
   `judge_omitted` (no verdict). Trace-gated criteria are not sent as judgeable.
5. Evidence hygiene: transcript and trace text are escaped inside tagged blocks so they cannot forge
   roles or close blocks; weights render as integers.
6. Stability measurement: a CLI (`voice-eval judge-stability <run-id> --times N`) that judges a run N
   times without saving and prints per-criterion band spread and overall spread. Running it costs
   N gpt-6-luna calls → ask the user before each real run.

Result shape: `version: 2`; criterion adds `band` (1–5 | null), `failureTags` (string[]),
`unobservableReason` (string | null); `score` stays (mapped). Older stored results (no version) keep
rendering.

## Constraints
- Only gpt-6-luna, effort low, generous limits. No new config knobs.
- Single model call per judgement (stability is measured first; sampling only if needed).

## Tasks
- [x] T1 Backend judge v2: schema, prompt, parsing, bands, caps, gating, escaping, brief — route: delegated
- [x] T2 Frontend: bands, failure tags, unobservable reasons, v1 compatibility — route: delegated
- [ ] T3 Stability CLI + measurement on ec3633f4 (paid; ask) — route: delegated + inline run

## Acceptance criteria
- Bands/caps/gating enforced in code with tests; prompt documents anchors and caps.
- Report shows bands, tags and typed not-observable reasons; old results still render.
- Stability measured: per-criterion band spread reported for ≥3 judgements of one run.

## Progress
- T1 f8b7942 (delegated; ~980 lines; RED observed; pytest 749). Reviewed with 791affe/2b615e1
  (1132 lines): correction_required — CRITICAL R3-median-overflow-test (p50 median of two huge
  floats could overflow; test relied on it). Corrected in 70f79bd (median halves before adding),
  targeted validation APPROVED + acknowledged.
- T2 a906b0c (delegated; RED observed; vitest 324, lint, typecheck): bands, capped badge with text
  explanation, failure-tag chips, unobservable reasons, run-level tag summary; v1 results unchanged.
- T3 CLI 8e6d770 (delegated; RED observed; pytest 766): `voice-eval judge-stability <run> --times N
  [--json]`, single Langfuse fetch, N judge calls, nothing stored. T2+T3 reviewed (1063 lines):
  APPROVED + acknowledged. Advisories: CLI judge-failure / master-key exits untested; evaluator
  KeyError now fails during collecting instead of judging; unjudgeable-run test doesn't assert no
  paid calls.
- Stability run 1 (user-approved, 3 paid calls) on ec3633f4: overall 68/80/71 (spread 12);
  bands: "asks for missing data" 2/5/2 (spread 3, unstable), "email content" 2/2/2, tone 5/5/5,
  readout 5/5/5, latency 3/3/4. Cause (transcript A3–A6): the generic "por motivos de agenda" was
  judged sometimes as a fabrication (cap 2) and sometimes as filler (5), and it also lowered the
  email-content criterion — a rubric fork, not noise.
- User decision (2026-10-11): only concrete facts count as fabricated; generic filler never caps
  and lowers at most one band on a criterion about that wording. Encoded in 2d96aac (+ "one defect,
  one place" rule), test added, pytest judge 101 passed; backend rebuilt.
- Next: re-measure stability (3 paid calls, ask).
