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
- [x] T1 Backend: model + migration 0012, service, auth resolution, endpoints, WS, tests, README — delegated
- [x] T2 Frontend: Settings → API keys page (list, create-once dialog, revoke) — delegated
- [x] T3 End-to-end check: create a key in the UI flow, call the API with it, revoke, see 401 — inline

## Acceptance criteria
- A key authenticates REST and the live WS; revoked/expired keys get 401; the secret is never
  stored or returned again; tests cover all of it.
- Backend pytest + ruff, frontend vitest + lint + typecheck pass.

## Progress
- T2 ce9d4c1 (delegated; RED observed; vitest 380): Settings → API keys (table, create-once dialog
  with copy + curl example, revoke with stuck-proof guard, nav entry).
- T1 24d6871 (delegated; RED observed; pytest 911): `modules/api_keys` (key `ve_<8>_<43 base62>`,
  SHA-256 only, prefix lookup + `hmac.compare_digest`), `authenticate_bearer` (exact key format →
  API key, else session token), `last_used_at` ≤ once/min, deactivated users' keys stop working,
  migration 0012, live WS Bearer support, README curl guide.
- Review of ce9d4c1..24d6871 (1793 lines): APPROVED + acknowledged. Advisory fixed in bcccd47: the
  live WS now admits a valid session cookie before a Bearer header, like HTTP (RED observed).
  Accepted: the create form's duplicate-name mapping can't trigger (shared helper requires it).
- T3 e2e against the stack: create 201 (prefix shown, key once) → GET /api/runs with the key 200 →
  list via key has no `key` field → revoke 204 → same key 401 "Not authenticated".
