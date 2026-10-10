# Feature: dockerize

## Objective
Rename the apps (`engine/` → `backend/`, `web/` → `frontend/`), fix the open advisory review findings,
and containerize the platform with a root `compose.yaml` that starts the database, backend and frontend.

## Problem / why
The user wants clearer app names, the known issues fixed, and a one-command way to run the whole
platform (requested 2026-10-09).

## Scope (authorized 2026-10-09)
- Rename directories and path references (Python package `voice_eval` keeps its name).
- Fix advisory findings recorded in `odd/tasks/backend-foundation.md` and `odd/tasks/web-shell.md`.
- Dockerfiles for backend (FastAPI/uv) and frontend (Next.js standalone), root `compose.yaml` with
  Postgres, backend (runs migrations on start) and frontend; root `.env.example` for compose secrets.
- Out of scope: production deployment, TLS, CI.

## Constraints / decisions
- Containers run as non-root, multi-stage builds, healthchecks, no secrets baked into images.
- Compose reads secrets (e.g. `VOICE_EVAL_MASTER_KEY`) from a gitignored root `.env`; only placeholders
  in `.env.example`.
- Frontend proxies `/api/*` to the backend service over the compose network (`BACKEND_URL` is baked at
  build time, so it is a build arg).
- The parent cannot read `.env*` files (permission deny rule): env templates need the user's check.

## Tasks
- [x] T1 — Rename `engine/` → `backend/`, `web/` → `frontend/` and references. Route: inline (mechanical).
- [x] T2 — Backend advisory fixes. Route: delegated writer.
- [x] T3 — Frontend advisory fixes. Route: delegated writer.
- [x] T4 — Dockerfiles + root compose + docs. Route: delegated writer.

- [x] T5 — Fix shared-IP login lockout (authorized 2026-10-09): edge reverse proxy as the only published
  service, overwriting X-Forwarded-For with the real peer, routing `/api` straight to the backend; backend
  trusts only the edge's fixed address. Plus compose smoke script and standalone `public/` copy.
  Route: delegated writer.

## Acceptance criteria
- Backend: pytest, ruff check/format green. Frontend: lint, typecheck, tests, build green.
- `docker compose up --build` starts db, backend (migrated, healthy) and frontend; `/api/health` is ok
  through the frontend origin; login works with a user created via `docker compose exec backend voice-eval create-user`.

## Checks
`cd backend && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`
`cd frontend && pnpm lint && pnpm typecheck && pnpm test --run && pnpm build`
`docker compose config -q && docker compose up --build -d && docker compose ps`

## Progress
- Branch `feat/dockerize` created from `feat/web-shell` (HEAD 01d8024).
- T1 done inline: directories moved (ignored dirs included), `.gitignore`, READMEs and settings docstring
  updated; venv recreated and deps reinstalled. Backend 203 passed, frontend 102 passed + typecheck.
  `backend/.env.example` still mentions `engine/.env` in a comment (parent can't edit `.env*`);
  `frontend/.env.example` remains uncommitted pending the user's check.

- Rename commit `5d4e85d`: native assess counts the moves as delete+add (336 paths, 37,966 lines, high
  because auth tests moved) — far beyond the reviewer budget; not started. Content is identical to the
  already-reviewed commits at their old paths. Reviewed boundary for the next units = 5d4e85d.

- `902f109`: `frontend/.env.example` committed after the user confirmed placeholders only.
- T2 + T3 done by one delegated writer (28 items). Backend 203 → 274 tests; frontend 102 → 151 tests;
  ruff, lint, typecheck, build green. Behaviour-level RED captured in a scratch worktree (32 failed);
  items that already worked are marked as "passed immediately" in the writer report.
- Backend A (SSRF guard `platform/egress.py` pinning connections to vetted public IPs, unsafe-secret
  rule, tester catch-all, 422 shape, integrity mapping, envelope checks): reviewed, APPROVED
  (lineage review-2ddbadeb0d139394). Advisory: resolution+connect share no time budget; dev-mode test
  depends on loopback port 9; resolution-timeout branch untested.
- Backend B (explicit session touch, CLI exit codes, anchored `.env`, expired-session purge, separate
  migration DB, length constants): reviewed, APPROVED (lineage review-bc205000665342f3). Advisory:
  purge in login path can contend (no SKIP LOCKED); `.env` anchor breaks for non-editable installs
  (T4 must install editable or rely on env vars); CLI doesn't catch every migration error.
- Frontend commit: whitespace secrets, delete guard, per-row testing state, drawer closes on route
  change, focus after delete, explicit table roles, field errors clear on edit, type-level IconButton test.
- Open risks: SSRF guard covers connection checks only (runtime TTS clients unguarded); stored
  non-ASCII secrets must be re-entered; frontend 409 split depends on backend message text.

- T4 done by delegated writer: backend image (uv 0.12, python 3.13-slim, editable install at /app,
  non-root uid 10001, read-only rootfs, entrypoint migrate → uvicorn, stdlib healthcheck, 389 MB);
  frontend image (node 24 alpine, pnpm via corepack, Next standalone, non-root, 295 MB); root
  `compose.yaml` (db not published, backend not published, frontend on 127.0.0.1:3000, required
  POSTGRES_PASSWORD / VOICE_EVAL_MASTER_KEY, healthcheck-chained startup); root README; old
  `backend/docker-compose.yml` removed. Smoke (writer): all healthy in ~18 s, health ok through the
  frontend, create-user, login cookie, /me 200, unauthenticated /api/connections 401, down -v clean.
  Parent re-check: `docker compose config` ok, no leftover containers, frontend 151 tests.
- Root `.env.example` NOT created: permission rules deny writing `.env*`; draft placeholders in the
  session scratchpad for the user to copy. `backend/.env.example` is stale (old compose, `engine/.env`).
- Open risks: every browser login counts against the frontend container IP (Next rewrites forward a
  client X-Forwarded-For unchanged, so trusting it would allow spoofing) → 20 failed logins in 15 min
  from anyone block all browser logins; needs the frontend proxy to set the peer address. `:?` vars
  make every compose subcommand need the env; POSTGRES_PASSWORD must be URL-safe.

- Docker commit reviewed: high (entrypoint shell), 4 lenses, APPROVED + acknowledged
  (lineage review-8df3a17c07587451). Advisory: shared-IP login lockout (3 lenses agree); missing root
  `.env.example` breaks the documented first step; stale `backend/.env.example`; standalone image
  doesn't copy `public/` (none today); no automated container smoke test; minor README/dockerignore nits.

- T5 done by delegated writer: `edge` nginx-unprivileged service is the only published one
  (127.0.0.1:${FRONTEND_PORT:-3000}); overwrites X-Forwarded-For/X-Real-IP with `$remote_addr`, routes
  `/api` → backend, rest → frontend (WebSocket upgrade passed); fixed subnet + `ip_range` reserve the
  edge address; backend `FORWARDED_ALLOW_IPS` = edge IP only. Frontend image copies `public/`.
  `scripts/compose-smoke.sh --ephemeral` (isolated project/port/subnet, throwaway secrets, `down -v`):
  parent re-run all PASS — forged XFF ignored (recorded = edge-seen peer), direct backend call with
  forged XFF recorded as caller, client B locked out while client A still logs in; no leftovers.
- Open risks: all host browsers share the Docker gateway IP as one throttle key (documented); regular
  (non-ephemeral) smoke mode untested; X-Forwarded-Proto always http behind a TLS terminator; WebSocket
  idle cap 300 s; smoke images not removed.

- Edge commit reviewed: high, 4 lenses, APPROVED + acknowledged (lineage review-b9b3b5e19fbd566d).
  Advisory: upstream keepalive without `keepalive_timeout` can race Node/uvicorn idle closes (sporadic
  502s); operators who set FORWARDED_ALLOW_IPS to the frontend IP (old README) keep the bug; smoke
  `usage()` prints a hard-coded line range; minor duplication/comment nits.

- Follow-up (authorized 2026-10-09): `keepalive_timeout 4s` on both nginx upstreams (below the 5 s idle
  timeout of uvicorn and Node) to avoid reusing upstream sockets they already closed. `nginx -t` ok;
  ephemeral smoke all PASS.

- `d2ca931`: `voice-probe --tts-connection NAME_OR_ID` builds TTS from a stored connection (resolver by
  name or id; test-first: RED → 281 passed).
- First VOICE run against dev (2026-10-10, authorized by user "pruébalo tú"; thread
  5bfc57c9-e3cf-4efe-a3c8-b7b84bc697da; stored `OpenAI` connection, gpt-4o-mini-tts/alloy), run from the
  backend container: protocol realtime (gpt-realtime-2.1); the agent's STT transcribed both synthesized
  utterances word-for-word → OpenAI `pcm` output is 24 kHz PCM16 as assumed (open risk closed); server VAD
  emitted speech_started/stopped for each turn; 2 agent turns, `response_done`; latency 1.62 s / 1.79 s
  (last caller frame → first agent audio; includes server VAD 500 ms + TTS trailing silence); close 1000.
- CONFIRMED turn-taking defect: agent turn 0 had 21.3 s of audio delivered by 12.96 s, and the caller
  spoke again at ~17 s, i.e. while the agent would still be talking (until ~30.5 s) in a real call. The
  simulated caller must wait for playback (first agent audio + audio duration), not `response.done`.
- Ops notes: `/tmp` in the backend container is tmpfs (`docker cp` can't read it; stream with
  `exec tar`); artifacts copied to `backend/runs/` (gitignored).

- `b547c8c`: playback-aware turn-taking — before each caller turn the probe waits until the previous
  agent turn's `first_audio_ms + audio duration + --playback-grace-ms` (default 400), bounded by
  max-seconds and turn timeout; `--no-playback-wait` opt-out; summary gains playback fields. Test-first
  (6 RED → GREEN), 287 backend tests pass (parent re-run).
- Slice `d419b7a..b547c8c` (516 lines) reviewed: medium, APPROVED + acknowledged
  (lineage review-bd5019825a280b12). Advisory: passphrase keys no longer fail fast on a mistyped Fernet
  key (accepted tradeoff, user decision 2026-10-10); `--tts-connection` CLI wiring untested; playback
  e2e tests use tight wall-clock tolerances. (Name lookup is safe: names are unique by constraint.)

## Next step
Build agents/scenarios/runs/live in the UI on top of the validated engine.
User creates root `.env.example`/`.env`; fix the shared-IP throttling follow-up; browser E2E.
