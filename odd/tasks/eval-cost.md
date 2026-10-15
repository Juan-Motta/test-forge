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
- [x] T3 Usage capture: realtime `response.done` usage, chat completions usage (caller + judge),
      TTS usage; stored in summary/judgement — delegated
- [x] T4 Price table (Settings, editable, seeded) + cost in run report, runs list and live view — delegated
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

- T3+T4 (delegated writer, uncommitted). Usage: `ports/usage.py` `UsageMeter` (disjoint buckets
  `text_in`, `cached_text_in`, `audio_in`, `cached_audio_in`, `text_out`, `audio_out` per model,
  plus `notes` codes); each adapter keeps one as `usage` under the model it is billed as (Azure
  deployments map to gpt-6-luna / the scenario's realtime model / gpt-4o-mini-tts in
  `connections/runtime.py`). Chat Completions (policy + judge): every answered attempt, malformed
  ones too (`prompt_tokens` minus `cached_tokens`, `completion_tokens` incl. reasoning). Realtime:
  every `response.done` incl. cancelled responses (details split cached out; missing details fall
  back to totals as text). TTS: the speech endpoint streams raw PCM with no usage, so input is
  estimated at 4 chars/token and audio output is flagged `tts_audio_not_metered` (cost incomplete,
  "TTS audio not priced"). Run usage goes to `summary.json` / `runs.summary.usage`; judge usage per
  result (`JudgeResult.usage`) and summed over every attempt in `run_judgements.usage` (migration
  0014, which also creates and seeds `model_prices`).
- Prices: `modules/pricing` (domain `run_cost`, `GET/PUT /api/pricing`); `RunOut.cost`
  `{callerUsd, judgeUsd, totalUsd, complete, notes, breakdown}` on list/detail/batch/cancel
  (null for old runs). Frontend: Settings → Model prices page (editable table, source, as-of,
  approximate note), `RunCostCard` in the report under the verdict, a `Cost` column in the runs
  table, guide sections. Live running cost not done (optional).
- Review fixes from ff9c43b: live reducer updates `turnState` on the realtime decision's spoken
  path (hang-up); `_caller_text` never breaks the audio turn (warns once per line).
- Checks (T3+T4): backend `uv run pytest -q` 1127 passed; ruff check + format clean; frontend
  `npx vitest run` 667 passed with `--maxWorkers=4` (default workers: 1-2 unrelated timeouts that
  pass alone), lint, typecheck, build clean.
- Follow-up: `backend/migrations/env.py` does not import `modules.pricing.models` (outside the
  writer's surface), so alembic autogenerate would not see `model_prices`.
- Commits: T1+T2 ff9c43b (reviewed medium, APPROVED + acknowledged); T3+T4 482e7d0 with the two
  ff9c43b findings (stale turnState on a realtime decision for a shown line; a live-text publish
  error no longer fails the caller turn) and `migrations/env.py` importing the pricing models
  (reviewed medium, APPROVED + acknowledged); 8d9a2dc review fix: prices limited to 4 decimals
  (Numeric(12,4) would round silently) and the price field is text so a typo is refused instead
  of dropped (assessed under_budget). Full checks: backend 1127 passed, frontend 669 passed
  (`--maxWorkers=4`; the default worker count times out unrelated 5 s tests), lint, typecheck,
  build.
- TTS: the speech endpoint streams raw PCM with no usage; input tokens are estimated (chars/4)
  and audio output is not priced, so pipeline costs are marked incomplete ("+").
- T5 pending: a real run to see the cost and the live evaluator text (paid; ask first).

