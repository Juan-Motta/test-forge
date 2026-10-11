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
- [ ] T1 Backend judge v2: schema, prompt, parsing, bands, caps, gating, escaping, brief — route: delegated
- [ ] T2 Frontend: bands, failure tags, unobservable reasons, v1 compatibility — route: delegated
- [ ] T3 Stability CLI + measurement on ec3633f4 (paid; ask) — route: delegated + inline run

## Acceptance criteria
- Bands/caps/gating enforced in code with tests; prompt documents anchors and caps.
- Report shows bands, tags and typed not-observable reasons; old results still render.
- Stability measured: per-criterion band spread reported for ≥3 judgements of one run.

## Progress
(none yet)
