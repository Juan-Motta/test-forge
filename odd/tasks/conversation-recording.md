# Feature: conversation-recording

Branch: `feat/conversation-recording` (on `feat/ui-fidelity`). Delivery: one PR stacked on `feat/ui-fidelity`.

## Objective
Let the user listen to and download a run's conversation as ONE recording, both voices on the run
timeline (pauses, overlaps and barge-in cuts as they happened), instead of two unaligned WAVs.

## Decisions (2026-10-12)
- Mono mix (agent + caller summed, clipped to PCM16), 24 kHz, built on demand from the existing
  artifacts (`agent.wav`, `caller.wav`, `events.jsonl`, `summary.json`), so old runs get it too.
- Placement reuses the run-timeline alignment already in `modules/runs/levels.py`
  (`_agent_segments`, `_caller_segments`); no runner change.
- Endpoint `GET /api/runs/{runId}/audio/conversation` (audio/wav); the per-side endpoints stay.
- UI: the recording card's primary player + download is the conversation; per-side tracks
  become secondary.

## Tasks
- [x] T1 Backend: shared segment placement + mixer, endpoint, tests, OpenAPI/skill docs — delegated
- [x] T2 Frontend: conversation player + download in RecordingCard, per-side tracks secondary, tests — delegated (same writer)
- [x] T3 Verify against a real finished run in the browser — inline

## Acceptance
- The mixed WAV's length covers the run timeline; each voice starts at its run time (test with
  synthetic artifacts); an interrupted agent turn is cut where the caller cut in.
- 404 when the run has no audio; works for runs recorded before this change.

## Progress
- T1 (delegated writer): `levels.place_audio` (public, returns `PlacedAudio` agent/caller segments +
  duration) now feeds both `build_levels` (unchanged behaviour) and the new
  `modules/runs/conversation.py` mixer (copies into untouched regions, sums + clips only the
  overlaps; a synthetic 5-min run mixes in ~0.07 s). Route `GET /{run_id}/audio/conversation`
  declared before the channel route; inline by default, `?download=1` → attachment
  `run-<id8>-conversation.wav`; 404 Run/Audio. Skill guide documents it. RED: collection error
  (module missing), then 422 on the route before it existed. Checks: runs+skill pytest 114 passed;
  ruff check/format clean. Not committed (parent commits).
- T2 (delegated writer): `conversationUrl(id, {download})` in `api.ts`; RecordingCard's primary
  player is "Conversation" + "Download .wav" (`?download=1`) under the lanes; Agent/Evaluator tracks
  in a collapsed `<details>` "Separate tracks" with the not-aligned note. RED: new RunReport test
  failed before the change. Checks: vitest 558 passed; lint, typecheck, build OK.
- Next: T3 browser check against a real finished run.
- T1+T2 committed as ffd821d.
- T3 (browser, rebuilt containers, run 15098a5a, recorded before this change): the conversation
  endpoint returns 200 audio/wav mono 24 kHz, 68.08 s, equal to the levels timeline (68.077 s);
  the report shows the "Conversation" player + "Download conversation .wav" (?download=1) under the
  lanes, and the agent/evaluator tracks inside a closed "Separate tracks" section.

