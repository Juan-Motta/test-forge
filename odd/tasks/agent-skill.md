# Feature: agent-skill

Branch: `feat/agent-skill` (chained on `feat/api-keys`). Delivery: feature-branch-chain.

## Objective
Serve, through the API, an agent skill (Anthropic `SKILL.md` format) that tells an AI agent what
voice-evaluator is, what each endpoint does, the end-to-end flows and how to interpret results, so
an agent holding an API key can use the platform without reading the code.

## Why
The user wants coding/ops agents to contextualize themselves from the API itself (2026-10-12).

## Design
- `GET /api/skill` → `text/markdown`: `SKILL.md` with YAML frontmatter (`name: voice-evaluator`,
  `description:` when to use it) followed by:
  1. What the platform does (agents under test, scenarios, evaluator modes, runs/batches, live,
     judge, Langfuse), and auth (`Authorization: Bearer ve_…`, 401 meanings).
  2. Flows with exact requests/responses: set up (connections → agent → scenario), launch a batch,
     follow it (poll / live WebSocket), read the judgement and the brief, re-judge, cancel,
     compare runs, measure stability (CLI note).
  3. How to interpret: run statuses and end reasons, summary fields (latencies, turns, warnings,
     interruptions), transcript rows (heard vs unheard), judge v2 (bands 1–5 → 100/90/70/50/25,
     verdicts, caps, failure tags, unobservable reasons, `mustFailed`, `samples`/`sampleBands`,
     evidence refs A/C/T/R), costs of paid actions and when to ask a human.
  4. Endpoint reference GENERATED from the app's live OpenAPI schema at request time (method,
     path, summary, params, body fields, response shape), so it never drifts from the code.
- `GET /api/skill.zip` → a skill folder (`voice-evaluator/SKILL.md` + `reference/openapi.json`)
  ready to drop into an agent's skills directory.
- Auth: same as the rest of the API (API key or session); the curated prose lives in the backend
  package as Markdown so it is versioned with the code.
- UI: on Settings → API keys, a "Agent skill" card with the URLs, a copy button and a download.
- A test fails if any API route is missing from the generated reference or if the guide mentions a
  path that no longer exists.

## Tasks
- [ ] T1 Backend: guide content, OpenAPI-generated reference, endpoints, drift tests, README — delegated
- [ ] T2 Frontend: "Agent skill" card on the API keys page — delegated
- [ ] T3 Check: fetch the skill with an API key and read it as an agent would — inline

## Progress
(none yet)
