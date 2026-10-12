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
- [x] T1 Backend: local targets, scenario interruptions, runner barge-in, events — route: delegated
- [x] T2 Frontend: interruptions editor, transcript/live interruption display — route: delegated
- [ ] T3 Agent + scenario + real run against the local agent (ask before launching) — route: inline

## Acceptance criteria
- A run with an interruption sends `playback.interrupted` with a valid `audioEndMs` and the agent
  stops; the caller's next turn is based only on what it heard.
- The judge can see in transcript and traces whether the agent's memory reflects only heard text.
- Backend pytest + ruff, frontend vitest + lint + typecheck pass.

## Progress
- T1 197701a (delegated; RED observed; pytest 821; compose config ok; app.py wiring added inline).
- T2 1058bb1 (delegated; RED observed; vitest 344). Reviewed together (1789 lines): APPROVED +
  acknowledged. Advisories: live reducer maps agentTurn−1 to the detector index (can drift after a
  dropped empty reply); heard fraction is played / received-so-far (overstates when cut mid-stream);
  silence end condition can fire during a long simulated-playback wait (afterMs > maxSilence).
- b2d37e6 live player cuts queued agent audio on callerInterrupted (RED observed; vitest 347).
- Flaky: ScenarioEditor.test.tsx "name taken" test can exceed the 1 s waitFor under full-suite load.
- Stack rebuilt; host.docker.internal:8000 reachable from the backend container (TCP ok).
- Created agent "Vivi local agent" (ws://localhost:8000, channel 2a8204d3…, Origin
  http://localhost:3001, no Langfuse link yet) and scenario "Interrupción a mitad de una cuenta"
  (7d8b1fb0…, interrupt agent reply #1 after 4 s; criteria: no claim of unheard numbers (must 40),
  resumes near the last heard number (must 35), stops and answers (should 10), latency (should 15)).
- Real run b0b497f6 (user-approved; thread edc0b5aa-37ad-409d-b312-36f2e256a417) against the local
  Vivi container: completed. Interruption sent at 4021 ms of agent reply #1 (heard "Número 1–3";
  transcript at the cut reached 16). Vivi logs: response.done cancelled `client_cancelled`
  (01:41:09.905) then "Realtime interruption correction acknowledged" (01:41:10.991) — the fix
  path ran. Yet the agent answered "Llegué hasta el número 18" and resumed at 19 → its context
  still held unheard numbers (or it guessed); next reply after the cut took 3625 ms. Also a VAD
  split of the caller's first utterance produced an empty, cancelled (`turn_detected`) response.
- Judge (no Langfuse link): 58/100, mustFailed; both recall criteria fail (bands 2,2,1). It compared
  against 16 (full generated text) instead of the heard 3 → fixed in 052a310: interrupted turns
  render heard vs NOT heard text and the rubric says to judge recall against the heard part
  (RED observed; judge tests 117).
- Next: re-judge b0b497f6 (3 paid calls, ask); the user checks turn-2 model input in their
  tracing (LangSmith project vivi-dev is enabled in the local container) to see whether it held
  the full count or the interruption marker.
