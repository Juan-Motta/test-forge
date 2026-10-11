# Feature: runs-live

## Objective
Launch scenarios as real voice conversations (one or many in parallel), where an LLM-driven evaluator
plays the caller, persist every run, and watch/listen to runs live from the UI.

## Problem / why
Agents and scenarios exist, and the voice engine is validated, but the caller only says fixed lines.
The platform's core loop — evaluator talks to the agent following the scenario, the user watches and
listens — is missing.

## Scope (authorized 2026-10-10, option A chosen by the user)
- Evaluator "brain": text → LLM → TTS. The agent's own transcript events (legacy realtime
  `response.output_audio_transcript.done`; Live `voice.transcript.update`) are the evaluator's input,
  so no separate STT. An OpenAI / Azure OpenAI chat model decides each caller turn with structured
  output; the existing TTS speaks it; playback-aware turn-taking stays.
- Runs: batches (scenario × repetitions, concurrency), per-run state machine, artifacts (audio of both
  sides, transcript, events, summary) on a persistent volume, cancel.
- Live: backend → browser WebSocket stream (transcript, turn state, both audio channels) through the
  edge; Live monitor UI with listening controls; runs list and run detail.
- Out of scope now: judge/scoring and Langfuse fetch (next feature), speech-to-speech evaluator (B).

## Constraints / decisions
- Chat model lives on the provider connection: OpenAI `chatModel` (default `gpt-4.1-mini`), Azure
  OpenAI `chatDeployment`. Scenario gains `evaluatorConnectionId` (kind openai/azure_openai; defaults
  to the TTS connection when it has a chat model).
- Evaluator prompt = agent context + scenario context + persona + goal + instructions + facts (reveal
  only when asked) + conversation so far; output `{say, hangUp, reason}`; facts never all at once.
- End conditions enforced by the runner: max duration, max silence, hang-up rule; wait for agent
  playback before hanging up (open follow-up from the dockerize feature).
- Runs execute in the backend process as asyncio tasks with a global concurrency cap; on startup any
  run left `running` becomes `interrupted`. Artifacts under `/data/runs/<run-id>/` (compose volume).
- Live stream auth: same session cookie on the WebSocket upgrade; Origin checked like unsafe requests.
- Every remote call to the agent under test is a real, paid session — tests use fakes only.

## Tasks
- [x] T1 — Connections chat-model config + scenario `evaluatorConnectionId` (backend + editor field).
- [x] T2 — Evaluator policy port + OpenAI/Azure chat adapter (structured output), fully faked in tests.
- [x] T3 — Session runner: target ↔ policy ↔ TTS loop, end conditions, playback-aware hang-up,
  artifacts writer, event bus.
- [x] T4 — Runs module: batches/runs tables, launch/list/get/cancel API, task manager, volume.
- [x] T5 — Live WebSocket stream (backend) through the edge.
- [x] T6 — Frontend: launch panel in scenario editor, Runs list + run detail.
- [x] T7 — Frontend: Live monitor (transcript, turn state, audio listening).

## Delivery
Branch `feat/runs-live`, chained on `feat/agents-scenarios`. Each work-unit commit reviewed right after.

## Acceptance criteria
- A batch of N runs launched from the UI completes against fakes in tests, and against the real dev
  agent in one user-authorized manual run.
- Live page shows transcript and plays audio while a run is in progress.
- All suites, builds and the compose smoke pass.

## Progress
- Branch `feat/runs-live` created from `feat/agents-scenarios`.

- T1–T3 done by one writer, split into 3 commits via patches (each intermediate state verified green).
  - `9298afb` T1: OpenAI `chatModel` (default gpt-4.1-mini) / Azure `chatDeployment`; scenario
    `evaluatorConnectionId` (migration 0006, SET NULL); `resolve_evaluator` (explicit, else TTS
    connection if it can chat, else ScenarioNotRunnable); editor + connection form fields. 437 backend
    tests (parent re-run). Reviewed medium, APPROVED (review-da544da786cea222).
  - `d203034` T2: CallerPolicy port, pure prompt builder, OpenAI/Azure chat adapter with strict
    json_schema, one retry then safe hang-up, 20 s timeout. 478 tests (parent re-run). Reviewed medium,
    APPROVED (review-743f3594a4924a79). Advisory: empty `choices` not guarded; vacuous secret-log
    assert; max_duration hang-up rule only enforced in the runner.
  - `5c86e1c` T3: SessionRunner (policy↔TTS loop, end conditions, playback-aware hang-up with
    farewell, ordered event sink, artifacts writer), probe refactored onto shared helpers. 492 tests
    (parent re-run). Reviewed medium, APPROVED (review-53d4883773ce265d). Advisory (fold into T4):
    a sender-task exception can skip session close; a hanging sink blocks artifact writing; end
    reasons agent_ended/connection_closed/ready_timeout/protocol_error untested.
- Nothing verified against a real provider yet (all I/O faked).

- T4 + T5 done by one writer, split into 4 commits via patches (each state verified green; parent re-ran
  pytest at each: 505 / 528 / 538).
  - `27bcbe2` runner hardening (session always closed; sink drain bounded at 10 s; new end-reason tests).
    APPROVED (review-0c3749dc685ce1a5). Advisory: a sender failure can end up only logged if not polled.
  - `03055e6` runs persistence (migration 0007 run_batches/runs, snapshots, settings
    RUNS_MAX_CONCURRENCY/RUNS_DATA_DIR, voiceOverride honoured). APPROVED (review-3ec92050d056c71a).
    Advisory: service-level create_batch input validation; mark_started ignores rowcount.
  - `7c5b0c9` run manager + runs API + `runs-data` volume (startup recover → interrupted, shutdown,
    cancel run/batch, audio endpoints). APPROVED (review-89d0a7265dd270d6). Advisory: cancel-after-finish
    race; shutdown 20 s then engine dispose; some failure paths untested.
  - T5 live stream (WebSocket `/api/runs/{id}/live` and `/api/runs/live?batchId=`, cookie auth 4401,
    Origin 4403, unknown 4404, snapshot + camelCase events, binary audio frames tagged 0 agent / 1
    caller, backpressure drops audio and sends `lagging`; edge 1 h timeout on live routes): `b9b6cb4`,
    APPROVED (review-67419c8cf7e40c20). Advisory (fold into T6/T7 hardening): batch overview can miss
    its snapshot if the last run finishes during the DB read; an unguarded hub.event exception could
    break persistence of that event; text-backlog 1013 path untested; one sleep-based test.
- Compose smoke passed (after one transient Google Fonts failure during the frontend build).

- T6 + T7 + live hardening by one writer, split into 4 commits (each state verified green):
  - `36f8b85` hub publish guarded; batch snapshot kept ordered (subscribe-first + snapshot prepended even
    after end). APPROVED (review-fb812eb543945183).
  - `8a5fe0b` runs list, batches panel, real overview counts (239 FE tests). APPROVED
    (review-7aa7121e6085c2d3). Advisory: overview count-query errors silent; out-of-range page; failed
    count not polled.
  - `5e566d9` run report (dual native audio players — agent.wav is gap-less, not time-aligned with
    caller.wav —, transcript with evaluator intent, metrics, re-run, judge placeholder) and launch dialog
    (editor, library card, multi-select). APPROVED (review-430e69f6355f6a30). Advisory: launch
    double-submit guard lost if the dialog closes mid-request; "Launch selected" includes selections
    hidden by filters (paid runs) — fix next; untested failure paths.
  - T7 live monitor (`lib/live` socket seam, reconnect 1/2/4/8/15 s, 4401 login / 4403-4404 messages,
    Web Audio player with 150 ms jitter buffer, mix + volume, lagging badge, aria-live transcript, /live
    with batch overview, focus page, End call): `1d8832e`, 282 FE tests, lint/typecheck/build green.
    APPROVED (review-8d7e27cc63181909). Advisory (fix before/after first real use): one failing poll
    replaces the whole /live body with an alert; focus jumps when the focused run finishes; Listen start
    failure unhandled; snapshot of a finished run shows "Waiting for the agent"; batch snapshot rows not
    validated.
- Not yet exercised in a real browser nor against the real agent. Run list lacks persona/p50/turns
  (RunOut has no summary) — follow-up.

- User decision (2026-10-11): the evaluator uses ONLY `gpt-6-luna` (verified: released 2026-09-22,
  reasoning model, structured outputs on Chat Completions). Chat model no longer configurable; legacy
  `chatModel` ignored; `reasoning_effort="low"` always; 4000 max completion tokens; 30 s timeout;
  empty choices / length cut-off / empty content → one retry then safe hang-up. No new validation
  ("no unnecessary guardrails, generous limits"). Azure keeps `chatDeployment` (must be gpt-6-luna).
  550 backend / 282 frontend tests.

- First full real run (2026-10-11, run 9d9e6de0, thread 19071d01…): completed, caller_hung_up, 245 s,
  9+9 turns, latency 0.97–1.74 s; evaluator realistic. Bug found and fixed next commit: an empty agent
  response (no audio, no transcript — opened while the caller was still speaking) was treated as a turn,
  the evaluator spoke over the real reply and the agent's server VAD cut it. Fix: empty responses are
  dropped (bounded by max silence); re-check right before speaking (stale decision discarded and policy
  re-asked if the agent spoke again); agent barge-in recorded; live monitor shows only spoken caller
  lines (pending intent until `callerSpeaking`, removed on `callerDecisionDiscarded`). RED reproduced
  the real bug. 556 backend / 283 frontend tests.

## Next step
Rebuild stack, user-authorized first real run from the UI; then judge + Langfuse feature.
