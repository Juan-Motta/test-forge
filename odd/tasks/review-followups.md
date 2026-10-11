# Feature: review-followups

Branch: `feat/review-followups` (chained on `feat/judge-langfuse`). Delivery: feature-branch-chain.

## Objective
Close the review advisories and follow-ups still open after runs-live and judge-langfuse, starting
with the user-visible ones (paid runs launched by mistake, broken /live states, stuck delete guards).

## Why
The user asked to fix the pending items (2026-10-11). A verified inventory (current code, path:line)
found the items below still open; FS3, FS4 and the T1–T3 judge advisories are already fixed.

## Scope (verified open items)
Frontend — runs / live:
- FR2 /live: one failing poll replaces the whole page (LiveContainer.tsx:50-53).
- FR3 /live: Listen start failure unhandled (LiveRunPanel.tsx:57-62).
- FR4 /live: focus jumps to another run when the focused run ends (LiveContainer.tsx:136-137).
- FR5 /live: finished-run snapshot flashes "Waiting for the agent" (live-state.ts:101-112).
- FR6 launch double-submit guard and /live redirect lost when the dialog closes mid-request
  (LaunchRunsDialog.tsx:30,39,135) — paid runs.
- FR7 overview count-query errors shown as 0 (OverviewContainer.tsx:25-35); FR9 "Failed" count not polled.
- FR8 out-of-range `?page=` shows "21–20 of 20" (RunsContainer.tsx:24-29,86-87).
- FR10 launch failure paths untested.
- BR1 (UI part) runs list shows persona, turns and p50 latency.
Frontend — scenarios / agents / connections:
- FR1 "Launch selected" includes scenarios hidden by the filters (ScenariosContainer.tsx:82-83) — paid runs.
- FS1 delete in-flight guard stuck after `remove.reset()` (scenarios, agents, connections containers).
- FS2 scenario editor: failed connections load is silent (ScenarioEditorContainer.tsx:107,133,136).
- FS5 agent delete 404 leaves a stale row (agents/queries.ts:38-43).
Backend:
- BR1 RunOut: persona, caller/agent turns, p50 latency (runs/api.py:75-91).
- BR2 cancel after finish answers 202 with a finished status → 409 (runs/api.py:287-290, manager.py:196-209).
- BR3 empty-turn latency: caller_end lost when the empty and spoken turns complete together (turns.py:96-106, session.py:410-414).
- BR4 scenario `tag` filter not trimmed (scenarios/api.py:197, service.py:160-161).
- BJ1 `_reconcile` error mid-loop leaves committed rows unspawned (judgements/coordinator.py:161-170).
- BJ2 `SnapshotCriterion.weight` strict int (judge/domain.py:130) → accept integral numbers.
- BP1 egress: resolution + connects share no deadline (platform/egress.py:64,84-93).
- BP2 session/throttle purge without SKIP LOCKED (users/sessions.py:98-101, throttle.py:86-91).
- BP3 probe CLI hangs up before the last turn's playback ends (probe.py:123-124,270).

## Tasks
- [x] T1 Backend items BR1–BR4, BJ1, BJ2, BP1–BP3 — route: delegated writer (many files)
- [x] T2 Frontend scenarios/agents/connections FR1, FS1, FS2, FS5 — route: delegated writer
- [x] T3 Frontend runs/live FR2–FR10 + BR1 columns — route: delegated writer (after T1 contract)

RunOut contract for BR1 (camelCase): `persona: string | null` (scenario persona name from the
snapshot), `callerTurns: int | null`, `agentTurns: int | null`, `latencyP50Ms: int | null` (from summary).

## Acceptance criteria
- Each item fixed with a test that fails without the fix (or an explained exception).
- Backend pytest + ruff and frontend vitest + lint + typecheck pass.

## Forecast
~1.5k authored lines over 3 commits.

## Progress
- T2 218c00a (delegated; 330 lines; RED for each item; vitest 304). T3 83a7ac7 (delegated; 448 lines;
  RED per item; vitest 319, lint, typecheck). Reviewed together (778 lines): APPROVED + acknowledged.
  Advisory fixed inline in 791affe: the editor's error branch only replaces the form when nothing
  loaded yet (a failed background refetch used to discard unsaved edits) — RED observed.
  Accepted: launch close guard after failure only asserted via Cancel enabled; /live keeps the last
  focused finished run instead of the "No calls in progress" empty state.
- T1 105e326 (delegated; 449 lines; RED per item; pytest 703). BJ2 premise corrected: lax int already
  took 10.0 — real gap was "50"/True. Reviewed: APPROVED + acknowledged. Advisories fixed inline in
  2b615e1: cancel test wrapper now returns the manager's bool; egress timing margin widened; median
  guard for non-finite; discard of an unknown turn raises ValueError.
- Final checks: backend pytest 704 passed; frontend vitest 320 passed; stack rebuilt healthy.
  791affe + 2b615e1 (~90 lines) assessed under budget → pending in slice.

## Next step
Judge improvements inspired by vivi-evaluations (anchored 1–5 bands, worst-case caps, rationale
before score + closed failure tags, deterministic not_observable, stability measurement) — awaiting
the user's go-ahead.
