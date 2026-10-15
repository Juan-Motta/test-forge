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
- [x] T1 Live header: full thread id + copy button — delegated (with T2)
- [x] T2 Live evaluator transcript for the realtime evaluator (and pipeline/text if missing) — delegated
- [ ] T3 Usage capture: realtime `response.done` usage, chat completions usage (caller + judge),
      TTS usage; stored in summary/judgement — delegated
- [ ] T4 Price table (Settings, editable, seeded) + cost in run report, runs list and live view — delegated
- [ ] T5 Real check on a finished run — inline

## Progress
- T1 (delegated writer, uncommitted): new `ui/CopyButton` (+ `useClipboard`, now also behind
  `CodeBlock`); the live header shows the whole thread id (mono, `break-all`) with "Copy thread
  id" and a polite "Thread id copied"; the run report chip shows the whole id with the same button.
- T2 root cause: the realtime caller's line is opened by `callerSpeaking` with `say: ""` (its
  words are unknown when its audio starts) and its words came only in the later `callerDecision`,
  which the live reducer treated as a new pending intent, so the bubble kept only "Evaluator
  intent: realtime" (and a stale "About to say…" line). Fix: the adapter yields the model's
  `response.output_audio_transcript.delta` (and the older `response.audio_transcript.*`) as
  `CallerTranscriptDelta`; the runner publishes `caller_text` pieces for the line, the hub sends
  `callerText` and keeps snapshot caller lines (now with `decisionId`) current, and the reducer
  appends pieces and lets the final `callerDecision` replace the line text. The transcript row /
  judge input stays the whole `.done` transcript. "realtime" is no longer shown as an intent.
- Checks (T1+T2): backend `uv run pytest -q` 1091 passed; ruff check + format clean; frontend
  `npx vitest run` 651 passed (+1 new transcript test), lint, typecheck and build clean.

