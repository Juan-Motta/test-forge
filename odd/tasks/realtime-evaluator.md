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
- [ ] T1 Streaming TTS for the pipeline caller (OpenAI + Azure OpenAI) — route: delegated
- [ ] T2 Realtime evaluator mode (backend): scenario `evaluatorMode`, realtime caller adapter,
      runner integration (playback wait, interruptions, hang-up tool, transcripts, events) — delegated
- [ ] T3 Frontend: evaluator mode in the scenario editor; transcript/live unchanged — delegated
- [ ] T4 Real runs: compare pipeline vs realtime latency on a local-agent scenario (paid; ask) — inline

## Acceptance criteria
- Pipeline caller: time from decision to first caller audio ≈ TTS first-chunk time (measured).
- Realtime mode: a run completes with the realtime caller following persona/goal/facts, hanging up
  via tool, interruptions still work; latency measured and compared.
- Backend pytest + ruff, frontend vitest + lint + typecheck pass.

## Progress
(none yet)
