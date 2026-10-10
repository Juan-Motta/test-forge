# Feature: agents-scenarios

## Objective
Let the user register the voice agents under test and author evaluation scenarios for them from the UI,
persisted in the backend, as the foundation for runs, live monitoring and judging.

## Problem / why
The engine is validated against the real agent (two dev voice runs, playback-aware turns), but targets
and scenarios still live in CLI flags. The platform needs them as managed, reusable data.

## Scope (authorized 2026-10-10)
- Backend modules `agents` and `scenarios` (CRUD, validation, migrations, tests).
- Frontend screens: Agents (list + form) and Scenarios (library + editor), following the design canvas.
- Out of scope: runs/orchestration, live streaming, judge, suites UI.

## Constraints / decisions
- Context is two-level, as the user asked ("contexto global o individual"): `Agent.context` describes
  what the agent does and applies to all its scenarios; `Scenario.context` adds scenario-specific context.
- Agent target: protocol (`auto` | `live` | `realtime`), WebSocket base URL (`wss://`, `ws://localhost`
  only in development), channel id, user id, optional Origin, optional Langfuse connection (kind
  `langfuse`). A fresh `threadId` is generated per run, never stored on the agent.
- Scenario: agent, name, tags, persona (name, language/locale, temperament, notes), evaluator voice
  (TTS connection + optional voice override), goal, behaviour instructions, caller facts (key/value,
  revealed only when asked), success criteria (text, kind must/should, evidence source
  transcript/trace/timing, weight; weights total 100), end conditions (max duration, max silence,
  hang-up rule).
- Anything the UI persists goes through the backend (user rule). Same API conventions as connections:
  camelCase JSON, sanitized `{type, loc, msg}` 422s, 404/409, auth required.
- Agents may be deleted only when no scenario references them (409), to avoid orphaned scenarios.

## Tasks
- [x] T1 — Backend `agents` module. Route: delegated writer (backend).
- [x] T2 — Backend `scenarios` module. Route: same backend writer.
- [x] T3 — Frontend Agents screen. Route: delegated writer (frontend).
- [x] T4 — Frontend Scenarios library + editor. Route: same frontend writer.

## Delivery
Branch `feat/agents-scenarios`, chained on `feat/dockerize` (feature-branch-chain). Each work-unit commit
is reviewed right after it is committed.

## Acceptance criteria
- Backend: pytest, ruff green; migrations round-trip; unauthenticated access 401.
- Frontend: lint, typecheck, tests, build green; screens persist everything through the API.
- Compose smoke still passes.

## Checks
`cd backend && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
`cd frontend && pnpm lint && pnpm typecheck && pnpm test --run && pnpm build`
`scripts/compose-smoke.sh --ephemeral`

## Progress
- Branch `feat/agents-scenarios` created from `feat/dockerize` (HEAD a0360d9).

- T1 + T2 done by one backend writer, split into two commits via patches. RED: T1 collection error,
  T2 64 errors (missing table); GREEN: T1 alone 356 passed (parent re-run), full 420 passed (parent re-run).
- `8bbbabb` T1 agents (migration 0004, CRUD, target_spec with fresh threadId, env-dependent URL rules in
  the service): reviewed medium, APPROVED + acknowledged (lineage review-70cc22037e8829cb). Advisory:
  IntegrityError race mapping untested; updatedAt assertion weak.
- `3653866` T2 scenarios (migration 0005, CRUD, filters, duplicate, criteria weights = 100, TTS kind
  check, agent delete guard 409): reviewed medium, APPROVED + acknowledged (lineage
  review-777799524a81924f). Advisory: agent-delete FK race and scenario commit-race mappings untested;
  `tag` filter not trimmed (empty/whitespace tag returns nothing).
- Decisions in brief: missing referenced agent/connection → 422 (not 404); PATCH null clears only
  optional references; scenarios can move between agents; duplicates keep criterion ids.

- T3 + T4 done by one frontend writer, split into three commits via patches (each state lint/typecheck/
  tests/build green). RED: suites failed to import containers; GREEN 208 tests (parent re-run 208), build ok.
- `bacea28` Agents screen: reviewed medium, APPROVED (lineage review-9e63a92d89bddffa). Advisory: 404 on
  delete leaves a stale row; server-error clearing, "Current connection" fallback and form-errors helper
  untested; URL credential check misreads `@` in a query without path; duplicate alert keys.
- `fb5d805` Scenarios data layer + library: reviewed medium, APPROVED (lineage review-83d81d8d0909f0f8).
  Advisory: delete guard can stick if the dialog is closed mid-request; load/duplicate/delete error
  paths untested; schema rules untested at unit level.
- Next commit: scenario editor (sections 1–6, criteria weight total, facts editor, unsaved-changes guard
  without back/forward blocking, Suspense around navigation required by cacheComponents) + this doc.
- Not yet checked in a real browser.

## Next step
Browser check of Agents/Scenarios with the user; then runs orchestration + live.
