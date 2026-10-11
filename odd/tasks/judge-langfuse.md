# Feature: judge-langfuse

Branch: `feat/judge-langfuse` (chained on `feat/runs-live`). Delivery: feature-branch-chain, ask-on-risk.

## Objective
After a run ends, a judge scores it against the scenario's weighted criteria using three evidence
sources — transcript, timing (summary.json turns/latencies) and the agent's Langfuse traces
(`session_id = threadId`) — and produces an overall score, per-criterion verdicts with evidence,
prioritized suggestions and an exportable Markdown brief for a coding agent. The run report shows it.

## Why
Runs today end with a transcript and metrics only; the user wants an actionable diagnosis of the
agent (prompt, tools, latency, flow) that can be handed to a coding agent.

## Scope
- Langfuse trace reader (public API v2 `GET /api/public/v2/observations?sessionId=` with cursor,
  field groups, time window; Basic auth; egress-guarded httpx like the connection tester).
- Trace digest: bounded, chronological, per trace: names, timings, models, TTFT, usage, tool calls
  (truncated io), errors/warnings. Raw observations saved as `langfuse.json` in the run artifacts.
- Judge: `gpt-6-luna` through the run's evaluator connection, structured output. Per criterion:
  verdict (pass | partial | fail | not_observable), score 0–100, rationale, evidence refs
  (source transcript | trace | timing + quote/ref). Overall score computed in code (weighted), plus
  `mustFailed` flag. Suggestions (title, detail, area, priority, evidence). Brief (Markdown).
- Persistence: `run_judgements` table (migration 0008), one row per run, status
  pending → collecting_traces → judging → completed | failed; result JSONB; trace stats; error.
- Orchestration: auto-judge when a run finishes completed (or failed with a transcript); traces are
  polled until the observation count is stable (Vivi uses langfuse 4.5.0 → v2 data may lag up to
  ~15 min), capped; if no traces arrive the judge still runs and marks trace evidence unavailable.
  Re-judge on demand. Non-terminal judgements resume on restart.
- Snapshot keeps the agent's `langfuse_connection_id`; older runs fall back to the agent row.
- API: `GET /api/runs/{id}/judgement`, `POST /api/runs/{id}/judgement` (re-judge).
- UI: "Score & suggestions" card in the run report (status, score, criteria, suggestions, brief with
  copy/download, re-judge); score in the runs list.

## Constraints
- Only `gpt-6-luna`; reasoning effort low (same as evaluator); generous limits (judge budget
  16000 completion tokens, 180 s timeout, one retry). No extra knobs.
- No secrets in errors/logs; Langfuse calls only through the guarded transport.
- Deprecated Langfuse v1 read APIs (sunset 2026-11-16 on Cloud) are not used.

## Tasks
- [x] T1 Langfuse trace reader + digest + runtime builder (backend) — route: delegated (writer; new provider module + tests)
- [x] T2 Judge core: generic structured chat call, prompt, schema, scoring, brief (backend) — route: delegated
- [x] T3 Persistence + orchestration + API + snapshot field (backend, migration 0008) — route: delegated
- [ ] T4 Report UI: Score & suggestions card + runs list score (frontend) — route: delegated
- [ ] T5 Docs + real validation on an existing run (needs the user's Langfuse connection linked to the agent; paid call → ask) — route: inline

## Acceptance criteria
- A finished run gets a judgement automatically; the report shows overall score, per-criterion verdicts
  with evidence, suggestions and a copyable brief.
- Trace evidence comes from Langfuse when the agent has a Langfuse connection; otherwise the judgement
  says traces were unavailable and trace-sourced criteria are `not_observable`.
- Re-judge replaces the previous result. Restarting the backend resumes pending judgements.
- Backend (pytest, ruff) and frontend (vitest, lint, typecheck) suites pass.

## Checks
- Backend: `uv run pytest -q`, `uv run ruff check . && uv run ruff format --check .` (in `backend/`).
- Frontend: `npm test`, `npm run lint`, `npm run typecheck` (in `frontend/`).

## Forecast
~2.5k authored lines across 4 code commits; each commit reviewed right after (lens budget ~1.7k).

## Progress
- T1 done: 740341a (route: delegated writer; 861 lines). Checks: pytest 575 passed, ruff clean;
  parent spot check 19 passed. Native review: medium, review-reliability, APPROVED + acknowledged.
  Advisory follow-ups (non-blocking): digest headers/trace names not counted against the budget
  (WARNING, langfuse_traces.py:439); non-finite numbers; Retry-After NaN; page cap silent to caller;
  truncation note budget. → fix in a small follow-up commit.
- T2 done: 9e1ed9d (route: delegated writer; 1702 lines). Checks: pytest 623 passed, ruff clean;
  parent spot check 45 passed. Native review: medium, review-reliability, APPROVED + acknowledged.
  Advisory follow-ups: caller policy relies on MalformedDecision being a ValueError (it is —
  evaluator/prompt.py:59 — add a test); parse_judgement should turn a malformed snapshot criterion
  into JudgeError (judge/domain.py:138-146); vacuous secret-log assertion in test_openai_judge.py.
- T3 done: 6c66c12 (route: delegated writer; 1665 lines, one commit — split would break app.py
  imports). Checks: pytest 649 passed, ruff clean; parent spot check 20 passed. Native review:
  medium, review-reliability, APPROVED + acknowledged. Advisories: crash between mark_finished and
  schedule leaves runs unjudged (recover doesn't reconcile); non-TraceFetchError from the reader
  fails the judgement; racy negative hook assertions; defensive score cast.
- Follow-up F1 (route: delegated writer, in progress): fix all T1–T3 advisories in one commit.
