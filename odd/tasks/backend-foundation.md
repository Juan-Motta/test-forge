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
- [x] T2b — Auth hardening from review (authorized 2026-10-09): login throttling, fail-closed
  ENVIRONMENT, single email canonicalization, argon2 off the event loop and outside DB transactions,
  rehash-on-login test. Route: delegated (writer, 3+ files).
- [x] T3 — Connections: model/migration, crypto, CRUD API with write-only secrets, per-kind config
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
  commit); `bfe90b2` feat — platform + users/auth code, migration, tests, env template, this document.
- Native review of `bfe90b2` (base fcb82d0, high risk: auth, 1474 lines): consent granted, 4 lenses,
  APPROVED and acknowledged (lineage review-6b63f4552cba2d01, burned). Reviewed boundary = bfe90b2.
  `fcb82d0` (deps/infra) and `597a1e7` (spike fixes, 374 lines) remain unreviewed.
- Advisory follow-ups (non-blocking, not yet authorized):
  - WARNING security: no login throttling (online guessing + argon2 CPU cost) — api.py:53-67.
  - WARNING security: ENVIRONMENT defaults to development → /docs public if unset — settings.py:24.
  - WARNING: email normalization differs between create_user and login (IDN/Unicode) — service.py:76.
  - WARNING: dummy hash computed on the event loop on first unknown-email login — service.py:77.
  - WARNING: login holds a pooled DB connection idle-in-transaction during argon2 — service.py:76-78.
  - WARNING: rehash-on-login path untested — service.py:81-82.
  - Suggestions: `.env` path is CWD-relative; CLI DB errors give tracebacks; resolve_session commits
    as a hidden side effect; session touch interval untested; migration round-trip test downgrades the
    shared test DB; unused `current_user`; `_fail` should be NoReturn; duplicated length literals.
- Open risks: no GC of expired sessions; client IP behind a proxy needs `--proxy-headers`; cookie-auth
  unsafe requests without `Origin` rely on SameSite=Lax.

- T2b done by delegated writer: DB-backed login throttling (`login_attempts`, migration 0002; 5/email,
  20/IP per 15 min, 429 + Retry-After before argon2, identical for unknown emails; success resets only
  the per-email counter; 429s not recorded); ENVIRONMENT defaults to production; `canonical_email` used
  by create/login/throttle; argon2 in worker threads with no DB transaction open (pool checked-out = 0
  proven); dummy hash warmed at startup; rehash-on-login tested. RED: 15 behavior failures; GREEN 113
  passed x2 (parent re-run 113 passed).
- Open risks: check-then-record not atomic (concurrent overshoot ≤ N−1); per-email lockout DoS inherent;
  client IP behind proxy needs `--proxy-headers`; Python vs Postgres `lower()` on exotic Unicode.
- Note: `engine/.env.example` (unreadable to the parent) may still lack `ENVIRONMENT=development` and the
  new LOGIN_* settings; local dev must set `ENVIRONMENT=development` to get /docs.

- Native review of `57fb843` (base bfe90b2, medium, 665 lines): consent granted, reliability lens
  APPROVED and acknowledged (lineage review-a9cadce63ec2b747). Reviewed boundary = 57fb843.
  Advisory: docs-gating test doesn't clear ambient ENVIRONMENT (test_health.py:41-46); no test that a
  successful login leaves the per-IP counter intact (test_login_hardening.py). Both folded into T3.

- T3 done by delegated writer (~2,070 authored lines, split for review). RED: 7 collection errors + 2
  failed/38 errors on existing suite (missing table); GREEN 203 passed x2 (parent re-run 203 passed).
  Mutation check: removing the sanitized 422 handler makes the leakage test fail (FastAPI echoes input).
  Parent added the connections models import to `migrations/env.py` (autogenerate visibility).
- Commits: `9cf6964` A — secret box (MultiFernet, token bound to owner+kind), domain, migration 0003,
  persistence, review test fixes (156 tests green at that commit; create_app master-key test moved to B).
  Reviewed: medium, APPROVED + acknowledged (lineage review-f9680fe7ede735ca). Advisory: to_domain
  branches untested; SecretBox.open doesn't guard envelope shape. Next commit B — API, testers, runtime
  resolver, global sanitized 422 handler, factory refactor, README, this document.
- Open risks: SSRF via test endpoints (fixed paths, https only, no redirects, no body read; private-IP
  resolution not blocked — consider egress allow-list before multi-tenant); no re-encrypt command for
  key rotation; `create_app` now requires `VOICE_EVAL_MASTER_KEY` (dev `.env` must set it; parent cannot
  read `.env.example` to confirm it has a placeholder); testers honor proxy env (`trust_env`).

- Commit `5caa493` B reviewed: medium, 1380 lines, APPROVED + acknowledged. Reviewed boundary = 5caa493.
  Advisory follow-ups: stale-test guard (row edited during check) untested; non-httpx exceptions
  (e.g. UnicodeEncodeError from a non-ASCII secret in a header) escape the tester unsanitized; 422 shape
  differs between domain and request validation; every IntegrityError reported as name conflict.

## Next step
Decide next module (agents/scenarios backend, or Next.js shell with login + connections screens).
