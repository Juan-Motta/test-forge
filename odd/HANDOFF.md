# Session handoff — voice-evaluator (2026-10-11)

Read this first when resuming. Then `mem_context` + `mem_search "voice-evaluator"` (Engram project
`voice-evaluator`) and the feature docs under `odd/tasks/`.

## What the product is
A platform to evaluate voice agents: an LLM-driven evaluator ("simulated caller") talks by voice to
the agent under test (a Vivi realtime WebSocket), following a scenario; runs are watched/listened live;
next, a judge scores each run with transcript + timing + Langfuse traces and produces suggestions and
a brief for a coding agent. Design canvas: https://claude.ai/artifact/BjePefionoj7skYJHXvuBD

## Repo layout
- `backend/` — Python (uv), package `voice_eval`: FastAPI API + engine (probe CLI, runner, evaluator).
- `frontend/` — Next.js 16 (App Router, cacheComponents, proxy.ts), Tailwind 4, TanStack Query, Vitest.
- `edge/` — nginx-unprivileged; the ONLY published service (127.0.0.1:3000): `/api/` → backend, rest →
  frontend, overwrites X-Forwarded-For (backend trusts only the edge IP).
- `compose.yaml` — db (postgres:17), backend (migrates on start), frontend, edge; volumes `db-data`,
  `runs-data` (/data/runs). Secrets from gitignored root `.env` (POSTGRES_PASSWORD, VOICE_EVAL_MASTER_KEY).
- `scripts/compose-smoke.sh --ephemeral` — isolated end-to-end smoke (auth, spoofed-IP, lockout).
- `odd/tasks/*.md` — one document per feature (decisions, progress, review outcomes).

## Branch chain (feature-branch-chain; nothing pushed, no PRs yet)
`main` (empty) ← `feat/live-probe-spike` ← `feat/backend-foundation` ← `feat/web-shell` ←
`feat/dockerize` ← `feat/agents-scenarios` ← `feat/runs-live` (current, HEAD ≥ 66f5849).
Push / PR / merge are the user's decision.

## Done (all code commits reviewed and APPROVED by native review unless noted)
1. **live-probe-spike** — Vivi protocol adapters (Live `voice.*` and legacy OpenAI-Realtime relay,
   auto-detect), TTS port, playback-aware turns. Validated with real dev calls.
2. **backend-foundation** — users + server-side sessions (argon2id, login throttling, CSRF Origin
   check), provider connections (OpenAI, Azure OpenAI, Azure Speech, Langfuse) with write-only
   encrypted secrets (MultiFernet; any non-empty master key accepted, passphrases stretched with
   scrypt), SSRF-guarded connection checks.
3. **web-shell** — Next.js shell, login, Connections screen (open-redirect bug found by review, fixed).
4. **dockerize** — rename engine→backend / web→frontend, Dockerfiles, root compose, edge proxy.
5. **agents-scenarios** — agents (global context, target config, import from cURL) and scenarios
   (persona, voice, goal, instructions, facts revealed on demand, weighted criteria = 100, end
   conditions); library + 6-section editor.
6. **runs-live** — evaluator brain (transcript → `gpt-6-luna` structured `{say, hangUp, reason}` →
   TTS), SessionRunner (end conditions, playback-aware, ignores empty agent responses, re-checks before
   speaking), runs/batches with snapshots, run manager (concurrency, cancel, interrupted on restart),
   live WebSocket (text + tagged PCM16 audio), UI: launch dialog, runs list/report, Live monitor with
   Web Audio listening.

Real validation against the dev agent: 3 full runs (9d9e6de0 found the empty-turn bug → fixed
cb3066c; 907b0661 and ec3633f4 clean; user confirmed live audio continuous after a452482).
Tests: backend ~556, frontend ~283.

## User rules / decisions (keep honoring)
- Replies in Spanish; artifacts (code, docs, UI copy) in English.
- Python + Next.js. Providers: OpenAI, Azure OpenAI, Azure AI Speech. No OS-native tools.
- Evaluator chat model is ONLY `gpt-6-luna` (reasoning_effort low, 4000 tokens, 30 s); never older models.
- "No unnecessary guardrails; generous limits without abuse." Don't add knobs/validation not asked for.
- Everything the UI persists goes through the backend.
- Option A evaluator (text→LLM→voice). Speech-to-speech (B) only later, if asked.
- Remote calls to the agent under test are paid sessions: ask before each real run unless the user
  says to launch.

## How to operate
- Stack: `docker compose up -d --build --wait` (root). UI http://localhost:3000.
- Permission rule: the assistant cannot read or write `.env*` files — ask the user to create/check them.
- Launching runs from the assistant: service user `automation@example.com`; reset its password each time
  inside the backend container with `hash_password` (random, never stored), log in via the edge with
  `X-Client: cli`, `POST /api/runs`, poll `GET /api/runs/{id}`, delete the temp token file.
- Artifacts: `/data/runs/<run-id>/` in the backend container (tmpfs `/tmp` and read-only rootfs; copy
  out with `docker compose exec -T backend tar -C <dir> -cf - . | tar -xf -`).
- Native review (RDD on): review each work-unit commit right after committing, base = previous commit;
  run gentle-ai commands literally (no `bash -c` with dynamic strings, no zsh globs); large changes are
  split into commits ≤ ~1.7k lines via writer-produced patches + stash; relay consent prompts to the user.
- Never `lsof -ti tcp:PORT | xargs kill` (it killed a desktop helper once); stop only own PIDs/containers.

## Next (in order of value)
1. **Judge + Langfuse feature** (new branch from `feat/runs-live`): user creates a Langfuse connection
   and links it to the agent; after each run fetch traces by `session_id = threadId`; judge with
   `gpt-6-luna` scores each criterion (evidence: transcript / trace / timing), overall score,
   suggestions, exportable brief for a coding agent; report UI fills the "Score & suggestions" section;
   batch comparison later.
2. **Open review follow-ups** (see `odd/tasks/runs-live.md`, `agents-scenarios.md`): "Launch selected"
   includes filter-hidden scenarios (paid runs) — highest; /live failing poll replaces the page; focus
   jumps when a run ends; Listen start failure unhandled; finished-run snapshot shows waiting state;
   launch guard lost on dialog close; cancel-after-finish race; RunOut lacks persona/p50/turns.
3. Possibly: newer OpenAI TTS model (currently `gpt-4o-mini-tts`), Azure Speech TTS adapter,
   speech-to-speech evaluator (B), push/PRs of the branch chain when the user decides.
