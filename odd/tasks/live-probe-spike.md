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

- T4 call 2 (2026-10-09, text turns, thread 18979847-7b31-4ab5-8ad2-d1b79477618a): protocol auto-detected
  `realtime` (gpt-realtime-2.1); 2 caller + 2 agent turns, both `end_reason=response_done`; latency
  781.6 / 738.7 ms (text send → first agent audio); clean close 1000; agent audio 24 kHz confirmed.
- Finding: agent audio arrives faster than real time (21.3 s of speech delivered in ~3.9 s), so
  `response.done` marks DELIVERY, not playback. A realistic caller must wait for playback time
  (first audio + audio duration) before speaking, or it effectively interrupts the agent.
- Still pending in T4: an audio (TTS) run — blocked on provider credentials in `engine/.env`.

- Native review (2026-10-09): full branch (3466 lines) refused with `lens_context_budget_exceeded`.
  Re-scoped to `f042862..efd41c9` (15 files, 1757 lines, medium): consent granted, reliability lens
  APPROVED, acknowledged (lineage review-1057a02986607db2, authority burned). Reviewed boundary = efd41c9.
  `f042862` (T1–T3) remains UNREVIEWED: the tool reviews only ranges ending at HEAD and that commit
  alone likely exceeds the budget.
- [x] T5 — Fix the 4 advisory review findings below (authorized by user 2026-10-09). Route: delegated
  (writer; source + tests across 3+ files).
- Follow-ups from advisory (non-blocking) findings:
  - Empty/whitespace `--text` crashes with a traceback after connecting (vivi_realtime.py:191-193).
  - Protocol-detection failure paths untested (detect.py:55-74), incl. forced `--protocol` mismatch.
  - `ResponseTurnTracker` fallback ends a turn while a response is still open (turns.py:151-153).
  - Test name overclaims `request_agent_turn` coverage on Live (test_vivi_realtime.py:132-136).

- T5 done by delegated writer: blank `--text`/`--say` rejected before connecting (exit 2); forced
  `--protocol` now verified against the first frame and fails fast on mismatch; open responses end
  only via `open_response_stall_ms` (20 s, `end_reason=stalled`); Live `request_agent_turn` asserted.
  RED observed for findings 1, 3 and the forced-mismatch part of 2; detection failures already passed;
  finding 4 assertion proven by temporary mutation. GREEN 58 passed x3 (parent re-run: 58 passed).

## Next step
T4 — run against dev, pending explicit authorization and provider credentials.
