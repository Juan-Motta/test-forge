# Feature: eval-cost

Branch: `feat/eval-cost` (on `feat/text-agents`). Delivery: fast-forward into `main` with the
text-agents work and push (user keeps everything on `main`).

## Objective
Three live/report improvements asked by the user (2026-10-15):
1. Show what the evaluator says in the live transcript (realtime evaluator today shows only
   "Evaluator intent: realtime").
2. Show the approximate cost of each evaluation — the evaluator's side only: the caller's
   responses (realtime, or chat + TTS in pipeline mode, or chat for text runs) and the judge
   (all samples).
3. Live sessions: the full thread/session id with a copy button.

## Decisions
- Cost = recorded token usage per call × a per-model price table editable in Settings, seeded
  with current published OpenAI prices (verified, with source and date); Azure may differ, so
  the UI labels it "approximate". Usage is stored per run (caller) and per judgement (judge).

## Tasks
- [ ] T1 Live header: full thread id + copy button — delegated (with T2)
- [ ] T2 Live evaluator transcript for the realtime evaluator (and pipeline/text if missing) — delegated
- [ ] T3 Usage capture: realtime `response.done` usage, chat completions usage (caller + judge),
      TTS usage; stored in summary/judgement — delegated
- [ ] T4 Price table (Settings, editable, seeded) + cost in run report, runs list and live view — delegated
- [ ] T5 Real check on a finished run — inline

## Progress
