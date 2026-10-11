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
- [ ] T6 — Frontend: launch panel in scenario editor, Runs list + run detail.
- [ ] T7 — Frontend: Live monitor (transcript, turn state, audio listening).

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

## Next step
T6 + T7 frontend (launch, runs list/detail, live monitor) via one writer.
