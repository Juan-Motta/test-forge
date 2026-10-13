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
- [ ] T1 Backend: shared segment placement + mixer, endpoint, tests, OpenAPI/skill docs — delegated
- [ ] T2 Frontend: conversation player + download in RecordingCard, per-side tracks secondary, tests — delegated (same writer)
- [ ] T3 Verify against a real finished run in the browser — inline

## Acceptance
- The mixed WAV's length covers the run timeline; each voice starts at its run time (test with
  synthetic artifacts); an interrupted agent turn is cut where the caller cut in.
- 404 when the run has no audio; works for runs recorded before this change.

## Progress
