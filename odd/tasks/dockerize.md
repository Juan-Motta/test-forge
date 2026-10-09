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
- [ ] T2 — Backend advisory fixes. Route: delegated writer.
- [ ] T3 — Frontend advisory fixes. Route: delegated writer.
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

## Next step
T2 + T3 advisory fixes.
