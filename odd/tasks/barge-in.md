# Feature: barge-in

Branch: `feat/barge-in` (chained on `feat/judge-v2`). Delivery: feature-branch-chain.

## Objective
Let the evaluator interrupt the agent mid-reply exactly like a person in the Vivi web client, so the
user can test Vivi's fix "correct unheard voice context after interruptions" (cx-backend c79c88d65)
against a Vivi backend running locally in another Docker container.

## Why
Before the fix, an interrupted agent kept its whole planned reply in memory as if it had been
heard. Our runner never interrupts (it waits for the agent's playback), and it cannot reach a
target on the host (`localhost` inside the backend container is the container itself).

## Verified Vivi contract (legacy realtime path; Live `voice.*` has no client interruption)
- Each `response.output_audio.delta` carries `item_id`, `response_id`, content index 0 and
  `playbackInterruptionSupported: true`.
- On barge-in the web client sends one custom event per item still playing:
  `{"type":"playback.interrupted","itemId","responseId","contentIndex":0,"audioEndMs":<int|null>}`
  (strict fields; `audioEndMs` = played ms = played samples / 24, ≤ received bytes / 48; null or 0
  = nothing heard). Raw `conversation.item.truncate` / `response.cancel` do NOT exercise the fix.
- The server then stores the interruption marker, sends `response.cancel` + `conversation.item.
  truncate` (or delete) itself, waits ≤ 5 s for `conversation.item.truncated`, and defers any
  `response.create` meanwhile. Later turns' model input (and Langfuse generation input) show
  "[Assistant audio was interrupted…" instead of the full text.
- Server VAD is on for web channels (`interrupt_response = allowInterruptions`, default true).

## Scope
1. Local targets: agent base URLs on a local host (`localhost`, `127.0.0.1`,
   `host.docker.internal`) accept `ws://` in any environment; inside the backend container a
   `localhost`/`127.0.0.1` target is dialled as `host.docker.internal` (compose sets the alias and
   `extra_hosts: host.docker.internal:host-gateway`). The Origin header is sent as configured.
2. Scenario `interruptions`: list of `{agentTurn: int ≥ 1, afterMs: int 300–60000}` (≤ 10). Stored
   (migration 0009), API, snapshot.
3. Runner (legacy realtime): track `item_id`/`response_id` and bytes per item from audio deltas;
   when the playback timeline of agent turn N reaches `afterMs`, cut the simulated playback, send
   `playback.interrupted` for every item still playing with its played ms, record a
   `caller_interrupted` event, and give the policy only the heard part of the agent's text
   (proportional to played vs received audio) to decide what to say, then speak. Transcript rows
   keep the full text plus `heard_text` and `interrupted: true`. Live protocol: not supported
   (warning).
4. UI: scenario editor "Interruptions" section; transcript/live show the interruption point and
   heard vs unheard text.
5. Scenario + real run against the local agent
   (`ws://localhost:8000`, channel `2a8204d3-bd82-4799-a8e8-8e669f318fec`, Origin
   `http://localhost:3001`).

## Tasks
- [ ] T1 Backend: local targets, scenario interruptions, runner barge-in, events — route: delegated
- [ ] T2 Frontend: interruptions editor, transcript/live interruption display — route: delegated
- [ ] T3 Agent + scenario + real run against the local agent (ask before launching) — route: inline

## Acceptance criteria
- A run with an interruption sends `playback.interrupted` with a valid `audioEndMs` and the agent
  stops; the caller's next turn is based only on what it heard.
- The judge can see in transcript and traces whether the agent's memory reflects only heard text.
- Backend pytest + ruff, frontend vitest + lint + typecheck pass.

## Progress
(none yet)
