# Feature: realtime-evaluator

Branch: `feat/realtime-evaluator` (chained on `feat/barge-in`). Delivery: feature-branch-chain.

## Objective
Lower the simulated caller's response latency and make it sound more natural: (1) stream the
caller's TTS so it starts speaking on the first audio chunk; (2) an optional per-scenario
realtime evaluator mode that listens to the agent's audio and answers by voice with
`gpt-realtime-2.1-mini` (speech-to-speech), keeping our turn control.

## Why (measured 2026-10-12, 21 caller turns over 5 real runs)
- Normally the caller starts ~490 ms after the agent's modelled playback end (400 ms grace +
  polling): the decision (gpt-6-luna p50 1.45 s) and TTS run while the agent's audio still plays,
  because agent audio arrives ~5x faster than real time.
- When agent audio arrives at real-time pace (e.g. right after an interruption) the whole chain
  shows: 3.5–4 s, of which ~2.6 s is TTS — `OpenAISpeechSynthesizer.synthesize` is not streamed.
- The user approved both steps (2026-10-12). gpt-6-luna stays the default chat model; other
  models may be used when they serve a purpose.

## Verified model facts (developers.openai.com, Azure catalog; 2026-10-11)
- `gpt-realtime-2.1` / `gpt-realtime-2.1-mini` (released 2026-07-06): WebSocket
  `wss://api.openai.com/v1/realtime?model=…`, Bearer auth; pcm16 24 kHz; manual turns with
  `turn_detection: null` (append → commit → `response.create`); output transcript events;
  function calling; voices alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar;
  sessions ≤ 60 min. Azure: `/openai/v1/realtime?model=<deployment>`.
- Prices per 1M audio tokens: 2.1-mini in $10 / out $20; 2.1 in $32 / out $64;
  gpt-4o-mini-tts out $12.
- `gpt-live-1` (`/v1/live/sessions`) has no documented manual turn control → not used.
- No TTS newer than `gpt-4o-mini-tts`.

## Tasks
- [x] T1 Streaming TTS for the pipeline caller (OpenAI + Azure OpenAI) — route: delegated
- [x] T2 Realtime evaluator mode (backend): scenario `evaluatorMode`, realtime caller adapter,
      runner integration (playback wait, interruptions, hang-up tool, transcripts, events) — delegated
- [x] T3 Frontend: evaluator mode in the scenario editor; transcript/live unchanged — delegated
- [x] T4 Real runs: compare pipeline vs realtime latency on a local-agent scenario (paid; ask) — inline

## Acceptance criteria
- Pipeline caller: time from decision to first caller audio ≈ TTS first-chunk time (measured).
- Realtime mode: a run completes with the realtime caller following persona/goal/facts, hanging up
  via tool, interruptions still work; latency measured and compared.
- Backend pytest + ruff, frontend vitest + lint + typecheck pass.

## Progress
- T3 42bd116 (delegated; RED observed; vitest 355): Evaluator radio (pipeline/realtime + cost
  note), realtime voice validation, Azure `realtimeDeployment`, run header label.
- T1 63631c6 (delegated; RED observed; pytest 838): `stream()` on the TTS port (OpenAI SDK
  `with_streaming_response`), caller speaks from the first chunk, byte-identical WAV/live audio;
  events `caller_decision.started_ms/duration_ms`, `caller_speaking.tts_first_chunk_ms`,
  `caller_speech_synthesized {tts_first_chunk_ms, tts_total_ms}`. Incident: during RED two tests
  briefly reached api.openai.com with the fake key `test-key` (401); fixed, all tests use fakes.
  T1+T3 reviewed (1098 lines): APPROVED + acknowledged. Advisories: synthesized event for a stale
  decision; unfinished utterance on mid-stream failure relies on polling.
- T2 f278dd0 + f03f81d (delegated; pytest 876; partial RED): realtime caller port + adapter over
  raw websockets (OpenAI `/v1/realtime?model=gpt-realtime-2.1-mini` Bearer; Azure GA
  `/openai/v1/realtime?model=<deployment>` api-key — the SDK's Azure path is still preview), manual
  turns (turn_detection null), hang_up tool, interruptions trim appended agent audio to the played
  ms, scenario `evaluatorMode` (migration 0010), realtime session uses the TTS connection. Reviewed
  (2070 lines): APPROVED + acknowledged. Advisories: a response discarded before first audio is
  cancelled but its partial output item is not deleted (model context may keep unheard words);
  feed-append failure and abandoned-before-created paths untested; idle gate cleared after send →
  fixed in 87c0ec1.
- Stack rebuilt.
- T4 (user-approved): same interruption scenario vs the local agent, batch ee85f6d4.
  - Pipeline 7f17d1f9: opening 2.0 s decision + 1.25 s first TTS chunk; after the cut 3.0 s
    (decision 1.3 s + first chunk 1.7 s); normal turns 459–522 ms after playback (grace-bound).
    Agent claimed "hasta el número 14" (heard 3); after the caller corrected it, resumed 4–8.
    Judge 70, mustFailed (claim criterion 1).
  - Realtime 21ff4bb1 (gpt-realtime-2.1-mini): opening first audio 0.55 s; after the cut 1.4 s
    (first audio 0.9 s). Agent claimed "hasta el número 20", resumed 21–25. Judge 44, mustFailed.
    Realtime caller issues: role confusion in C2 ("me cortaste ahí… luego te sigo desde ahí"),
    and it hung up via the tool without a spoken goodbye (no caller row after A2).
  - Both runs: an empty, cancelled agent response after the opening (server VAD split).
- 33aa150 (delegated; RED observed; pytest 885): role rules + interruption note rewritten, audible
  goodbye required (one retry when hang_up comes without audio), cancelled responses' output items
  deleted/truncated before the next response.
- Re-run realtime 6e8d5fbc (user-approved): goodbye retry worked (warning logged, then spoken
  goodbye). Role better at C2 but C3 still dictated the numbers itself and accepted the agent's
  false "17" (heard "1, 2"); the pipeline caller had corrected it. Agent memory bug again (claimed
  17). Judge 46, mustFailed; latency criterion not observable (T3 had no latency value).
  Latency: opening first audio 0.85 s; after the cut 1.3 s; normal turns ~1.3 s after playback end
  (the realtime caller can only start after hearing the whole turn, while the pipeline caller
  prepares during the agent's playback and starts ~0.5 s after it).
- Conclusion: pipeline stays the default; realtime helps only at the opening and right after a cut,
  and follows the script less reliably.
