# Feature: ui-fidelity

Branch: `feat/ui-fidelity` (chained on `feat/interruption-evidence`). Delivery: feature-branch-chain.

## Objective
Make the web app match the "Duet" design canvas (claude.ai artifact BjePefionoj7skYJHXvuBD, boards
01 Overview, 02 Live sessions, 03 Scenario editor + launch, 04 Run report + suggestions, 05 Agent
connection + Langfuse) as closely as possible, placing every feature built after the design
(judge v2, interruptions, evaluator modes, API keys, agent skill, public Swagger) in its visual
language, plus the minimum backend the design needs to work for real.

## Decisions (user, 2026-10-12)
- Scope: UI + necessary backend (aggregates, trace waterfall, audio levels, re-run, agent connection
  test). Out of scope: whisper to evaluator, pause queue, evaluator preview, webhook delivery.
- Scores stay on the 0–100 scale (the design's /10 copy is adapted); one score-band rule app-wide.
- Design files (local copy for workers): `<scratchpad>/design/project/*.dc.html`.

## Gap analysis (summary)
Tokens/fonts already match (`app/globals.css`, `app/layout.tsx`). Gaps are layout + missing
components: ScoreBar, KpiTile, Waveform/AudioLane, SegmentedControl, FilterChips, SearchField,
StackedProgress, Tabs, CodeBlock, RadioCard, Pin, Badge tones, PageHeader eyebrow, nav live badge,
API docs link. Per screen: Overview KPIs + Live-now strip + design table + weakest criteria;
Live batch progress + session cards with waveform + audio lanes + goals/metrics rail; Scenario
editor 3 columns (library rail, numbered cards, inline launch panel); Run report verdict row + tabs
(transcript & scorecard, Langfuse trace, suggestions, handoff); Agents master/detail with
connection/Langfuse cards and a test log.

## Backend contract (B1)
- `GET /api/stats/overview?days=7` → `{periodDays, runs: {count, previousCount}, averageScore,
  goalCompletion (share of judged runs with mustFailed=false, 0..1), latency: {p50Ms, p95Ms},
  live: {active}, weakestCriteria: [{text, scenarioName, averageScore, judged}] (top 5, lowest
  first), suggestions: {open, highPriority}}` (null fields when no data).
- `GET /api/runs/{runId}/trace` → `{available, note, stats, observations: [{id, traceId, parentId,
  type, name, startMs, durationMs, model, tokens, costUsd, level, statusMessage, depth}]}` from the
  run's `langfuse.json` artifact (offsets from run start; empty + note when none).
- `GET /api/runs/{runId}/levels?bins=140` → `{durationMs, agent: number[], caller: number[]}`
  (RMS 0..1 per bin on the RUN timeline, built from the audio events/artifacts so both lanes are
  aligned) + `turns: [{role, startMs, endMs, ref}]` for issue pins.
- `POST /api/runs/{runId}/rerun` → 201 batch (same scenario, repetitions 1) — paid, the UI confirms.
- `POST /api/agents/{agentId}/test` → `{reachable, latencyMs, protocol, log: [{ok, message}]}` —
  opens and closes the agent WebSocket only (no audio); the UI labels it as a live connection.

## Tasks
- [ ] F1 Foundation: tokens, `ui/` primitives, shell (nav live badge, env chevron, PageHeader eyebrow, API docs link) — delegated
- [ ] B1 Backend: the five endpoints above + tests + skill guide/README — delegated
- [ ] F2 Overview + runs list (KPIs, Live-now, design table, weakest criteria) — delegated (after F1, B1)
- [ ] F3 Live sessions (batch progress, session cards, audio lanes w/ client-side levels, goals/metrics rail) — delegated (after F1)
- [ ] F4 Run report (verdict row, tabs, scorecard w/ judge v2 + sampleBands, trace waterfall, recording lanes, suggestions grid, handoff, re-run) — delegated (after F1, B1)
- [ ] F5 Scenario editor (3 columns, numbered cards, inline LaunchPanel, evaluator RadioCards, interruptions card) — delegated (after F1)
- [ ] F6 Agents master/detail + connection test log, connections, API keys/skill restyle — delegated (after F1, B1)
- [ ] V Visual check of every screen in the browser against the design — inline

## Progress
(none yet)
