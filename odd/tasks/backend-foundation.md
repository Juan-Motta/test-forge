# Feature: backend-foundation

## Objective
Start the platform backend: FastAPI + PostgreSQL with a simple user/auth module and a provider
connections module, so credentials (OpenAI, Azure OpenAI, Azure AI Speech, Langfuse) are configured
from the UI, persisted in the backend and picked up on the next run without restarting.

## Problem / why
The spike reads provider credentials from environment variables, which forces a restart for every
change and cannot be managed from the UI. The user wants live-adjustable configuration and wants every
piece of UI state persisted through the backend.

## Scope (authorized 2026-10-09)
- Backend lives in the existing Python project `engine/` (package `voice_eval`), reusing the spike's
  ports/adapters. Screaming/hexagonal layout: `voice_eval/modules/<module>/` per business module,
  `voice_eval/platform/` for app factory, settings, database, security primitives.
- Users module: email + password login, server-side sessions, current-user dependency, CLI to create users.
- Connections module: CRUD with write-only encrypted secrets, connection test per kind, runtime resolver
  that builds provider clients from the stored connection on every run.
- Out of scope now: Next.js UI, agents/scenarios, run orchestration, judge.

## Constraints / decisions
- Rule from the user: anything the UI needs to persist goes through the backend (no browser storage for
  real state; only ephemeral view state may stay client-side).
- DB: PostgreSQL 16+ via SQLAlchemy 2 (async, asyncpg) + Alembic migrations; dev DB in docker compose;
  tests run against a real Postgres via testcontainers (Docker available locally).
- Auth: argon2id password hashing; opaque random session tokens stored only as SHA-256 hashes with
  expiry; delivered as HttpOnly cookie (SameSite=Lax, Secure configurable) and also accepted as
  `Authorization: Bearer` for CLI/API clients. No public sign-up: users created via CLI. Generic login
  errors; constant-time checks.
- Secrets: encrypted at rest (Fernet/MultiFernet, key rotation ready) with ONE master key from the
  environment (`VOICE_EVAL_MASTER_KEY`); never returned by the API (only a masked hint); never logged.
  Environment variables remain a fallback for the CLI when no connection is stored.
- Live updates: provider clients are built per run from the current stored connection (no caching
  across runs), so edits apply without a restart.

## Tasks
- [x] T1 — Platform scaffold: settings, async DB session, Alembic, docker compose Postgres, app factory,
  `/api/health`, testcontainers fixtures. Route: delegated (writer, 2+ non-trivial files).
- [x] T2 — Users + auth: user + session models/migration, argon2, login/logout/me, auth dependency
  protecting `/api/**`, `create-user` CLI. Route: delegated (same writer as T1).
- [ ] T3 — Connections: model/migration, crypto, CRUD API with write-only secrets, per-kind config
  validation, `POST /test` (stored and draft), runtime resolver feeding the TTS factory. Route: delegated.

## Delivery
Forecast well above ~400 authored lines (T1 ≈ 400, T2 ≈ 600, T3 ≈ 900). Branch `feat/backend-foundation`
is chained on `feat/live-probe-spike`. Delivery strategy: `ask-on-risk`; chain strategy chosen by the
user 2026-10-09: `feature-branch-chain` (each PR targets the previous branch; merge in order).

## Acceptance criteria
- `uv run pytest` green against real Postgres; `ruff check` and `ruff format --check` clean.
- Unauthenticated `/api/**` (except health and login) returns 401.
- No API response, log line or exception message contains a stored secret.
- Editing a connection changes the provider used by the next run without restarting the process.

## Checks
`cd engine && uv run pytest -q && uv run ruff check . && uv run ruff format --check .`

## Progress
- Branch `feat/backend-foundation` created from `feat/live-probe-spike` (HEAD 597a1e7).

- T1 + T2 done by one delegated writer (trigger: 2+ non-trivial files). RED: 6 collection errors
  (`voice_eval.platform` missing); GREEN: 90 passed x2 (58 existing + 32 new; parent re-run 90 passed);
  ruff clean; compose config OK. Skip path verified (no Docker → 23 skipped with reason).
- Decisions added by the writer: DATABASE_URL required (no default); login also rejects foreign Origin;
  fixed (non-sliding) session expiry; min password length 12; OpenAPI docs only in development.
- Parent fix: root `.gitignore` now ignores `.env` / `.env.*` (keeps `.env.example`) — settings read
  `engine/.env`, so real keys must never be committable.
- `engine/.env.example`: the parent cannot read `.env*` (permission deny rule); the user confirmed it
  holds placeholders only (2026-10-09) before it was committed.
- Commits (split with user approval to fit the native review budget; local history rewritten before any
  push): `fcb82d0` build — dependencies, uv.lock, docker compose, Alembic env (58 tests green at that
  commit); next commit — platform + users/auth code, migration, tests, env template, this document.
- Open risks: no GC of expired sessions; client IP behind a proxy needs `--proxy-headers`; cookie-auth
  unsafe requests without `Origin` rely on SameSite=Lax.

## Next step
T3 — connections module via one bounded writer.
