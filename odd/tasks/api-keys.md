# Feature: api-keys

Branch: `feat/api-keys` (chained on `feat/realtime-evaluator`). Delivery: feature-branch-chain.

## Objective
Personal API keys for voice-evaluator so CI, scripts or a coding agent can use the platform API
without a password login: launch runs, poll them, read judgements and briefs.

## Why
The user asked for API key support to access the platform (2026-10-12). Today the API accepts a
session cookie (browser) or a session Bearer token obtained by logging in with a password
(`X-Client: cli`), which is awkward for automation.

## Design
- Key format `ve_<8-char prefix>_<32+ random bytes, base62/urlsafe>`; shown once at creation.
  Stored: user id, name, prefix, SHA-256 of the full key (high-entropy secret → no slow hash),
  created_at, last_used_at, expires_at (optional), revoked_at.
- Auth: `Authorization: Bearer ve_…` is resolved as an API key inside the existing
  `current_principal` (session cookie first, then Bearer: `ve_` prefix → API key, else session
  token). Bearer requests already skip the Origin check. Revoked/expired/unknown → 401 (same
  response as a bad token). `last_used_at` updated at most once a minute.
- The key acts as its owner (same permissions as the user); managing keys requires an
  interactive session or a key of the same user — keep it simple: any principal of that user.
- Live WebSocket accepts the API key via `Authorization` header too.
- Endpoints: `GET /api/api-keys` (own keys, newest first), `POST /api/api-keys {name,
  expiresInDays?}` → 201 with `{…, key}` once, `DELETE /api/api-keys/{id}` → revoke (204).
- UI: Settings → "API keys": list (name, prefix `ve_abcd1234…`, created, last used, expires,
  status), "Create API key" dialog that shows the key once with copy + a curl example, revoke
  with confirmation.
- Docs: README "Using the API with an API key" (launch a run, poll it, get the judgement brief).

## Tasks
- [ ] T1 Backend: model + migration 0012, service, auth resolution, endpoints, WS, tests, README — delegated
- [ ] T2 Frontend: Settings → API keys page (list, create-once dialog, revoke) — delegated
- [ ] T3 End-to-end check: create a key in the UI flow, call the API with it, revoke, see 401 — inline

## Acceptance criteria
- A key authenticates REST and the live WS; revoked/expired keys get 401; the secret is never
  stored or returned again; tests cover all of it.
- Backend pytest + ruff, frontend vitest + lint + typecheck pass.

## Progress
(none yet)
