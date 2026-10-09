# Feature: live-probe-spike

## Objective
Prove that an automated client can hold a spoken conversation with the target agent's
realtime WebSocket (Vivi Live, `voiceCapability=live-v1`) before building the evaluator platform.

## Problem / why
Turn-taking and latency are the riskiest unknowns: the Live protocol emits no
speech-started / response-done events, so the client must detect the agent's end of turn
from the audio stream and caption updates.

## Scope (authorized)
- Python engine package under `engine/` (uv, Python >= 3.12).
- Vivi Live protocol client, audio helpers, end-of-turn detector, `probe` CLI.
- Caller speech comes from a TTS port (`SpeechSynthesizer`, PCM16 24 kHz) with OpenAI and Azure OpenAI
  adapters, or from a pre-recorded WAV. No OS-native tools: it must run as a web service (Linux).
- Out of scope: evaluator LLM, judge, Langfuse fetch, Next.js UI.

## Constraints / decisions
- Stack: Python (engine) + Next.js (web UI, later).
- AI providers: OpenAI, Azure OpenAI and Azure AI Speech (Cognitive Services) are all allowed for
  TTS / STT / live models; each capability is a port with per-provider adapters selected by config.
  The spike implements TTS for OpenAI + Azure OpenAI; Azure AI Speech is a later adapter.
- Accepted correction (2026-10-08): Langfuse traces do exist for voice sessions (transcript as text
  observations + tool calls, `session_id = threadId`), so the judge can use them.
- Target contract (validated in cx-backend): JSON text frames only; PCM16 mono 24 kHz base64;
  server → `voice.protocol`, `voice.ready`, `voice.audio.delta`, `voice.transcript.update`
  (cumulative caption per group), `voice.task.status`, `voice.closed`; client → `voice.input.audio`
  (base64 ≤ 131072 chars), `voice.close`. Agent greets first. Fresh UUID `threadId` per run.
- Running against the remote dev endpoint needs explicit user authorization (it starts paid sessions).

## Tasks
- [x] T1 — Scaffold `engine/` (pyproject, uv, pytest, ruff). Route: delegated (writer, 2+ non-trivial files).
- [x] T2 — Audio helpers + end-of-turn detector, test-first. Route: delegated.
- [x] T3 — Vivi Live client + `probe` CLI writing `events.jsonl`, `agent.wav`, `caller.wav`, `summary.json`. Route: delegated.
- [x] T3b — Legacy realtime adapter (OpenAI Realtime relay) + protocol auto-detection + text caller
  turns + close with 1000. Reason: first dev run (2026-10-09, thread 04af6979…) showed this channel's
  agent runs the legacy `RealtimeSessionManager` (gpt-realtime-2.1), not Live: no `voice.protocol`/
  `voice.ready`, agent never speaks first, `voice.close` rejected with 1011. Route: delegated (writer).
- [ ] T4 — Run the probe against dev and record latency/turn findings. Authorized by user 2026-10-09
  (1–2 calls). Call 1 used (greeting-only, failed on protocol mismatch). Audio run blocked: no `.env`
  with provider credentials found (`engine/.env`, `.env`).

## Acceptance criteria
- `uv run pytest` green; `uv run ruff check` clean.
- Probe CLI `--help` works; offline test against an in-process fake server passes.
- T4: one real call completes with greeting captured, ≥ 2 caller turns, per-turn latency in summary.

## Checks
`cd engine && uv run pytest -q && uv run ruff check . && uv run python -m voice_eval.probe --help`

## Progress
- Branch `feat/live-probe-spike` created.
- T1–T3 done by one delegated writer (trigger: 2+ non-trivial files). RED observed first per module
  (collection errors), then GREEN. Evidence: `uv run pytest -q` 28 passed (parent re-run: 28 passed);
  `ruff check` clean; `ruff format --check` clean; `python -m voice_eval.probe --help` OK.
- Open risks: OpenAI `pcm` 24 kHz not confirmed in docs (verify in T4); end-of-turn gap heuristic
  (900 ms) can split turns during long tool calls; latency includes TTS trailing silence.
- Work-unit commit: `f042862` (24 files, 2131 lines incl. 611 in generated uv.lock; over the ~400-line
  heuristic because T1–T3 plus the TTS scope change landed as one unit).
- Native review: assessed `medium` (`executable_change: .gitignore`), `review_due: slice_budget_reached`
  (base = empty tree, root commit). Preflight STATUS stopped at `collect: intended_untracked_selection`
  for the untracked `.atl/` files; submission refused as invalid JSON shape. Review PENDING, not approved.

- T3b done by delegated writer: TargetSession port, connection base, auto-detect (first frame), legacy
  adapter with allow-list guard, ResponseTurnTracker (settle 1200 ms, multi-response tool turns = 1 turn),
  `--text`/`--agent-first`/`--protocol`/`--settle-ms`. RED observed (import errors + 4 e2e failures), GREEN
  46 passed (parent re-run: 46 passed). Risk: legacy path proven only against the fake server.

## Next step
T4 — run against dev, pending explicit authorization and provider credentials.
