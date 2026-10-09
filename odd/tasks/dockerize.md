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
- [ ] T4 — Dockerfiles + root compose + docs. Route: delegated writer.

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

## Next step
T4 — Dockerfiles + root compose via one bounded writer.
