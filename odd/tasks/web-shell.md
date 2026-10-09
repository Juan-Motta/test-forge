# Feature: web-shell

## Objective
Build the Next.js application shell (layout, design system, auth, API client, routes) and its first
real screen, Connections, so provider credentials are managed from the UI against the backend.

## Problem / why
The backend already exposes auth and provider connections, but nothing can use them without a UI.
Configuring TTS credentials from the UI also unblocks the voice run against the target agent.

## Scope (authorized 2026-10-09)
- New app at `web/` (Next.js App Router, TypeScript strict, pnpm).
- Shell: sidebar navigation from the design canvas (Overview, Live sessions, Runs & reports, Scenarios,
  Agents, Settings), environment badge, header; sections not built yet show an empty state.
- Design system: tokens and base components matching the canvas (dark console look; blue = agent under
  test, amber = evaluator; Schibsted Grotesk + JetBrains Mono).
- Auth: login page, session via the backend cookie, logout, redirect to login when unauthenticated.
- Connections screen: list, create/edit per kind, write-only secrets, test (draft and stored), delete.
- Out of scope: other screens' functionality, Playwright e2e (later), deployment.

## Constraints / decisions
- User rule: anything the UI must persist goes through the backend; browser storage only for ephemeral
  view state.
- Same-origin API: Next.js rewrites `/api/*` to the backend (`BACKEND_URL`), so the session cookie is
  first-party and the backend's Origin check sees the web origin (must be listed in `WEB_ORIGINS`).
- Route protection in Next is UX only (redirect when no session cookie); the backend enforces auth.
- Architecture: feature folders (screaming), container/presentational components, atomic UI primitives.
- Stack defaults: Tailwind CSS with CSS-variable tokens, TanStack Query for server state,
  react-hook-form + zod for forms, Vitest + Testing Library + MSW for tests. Versions per current docs.
- English UI copy; accessible controls (real buttons/labels, 44px targets, 4.5:1 contrast).

## Tasks
- [x] T1 — Scaffold + shell + auth + API client (route: delegated writer, 2+ non-trivial files).
- [x] T2 — Connections screen (route: delegated writer).

## Delivery
Branch `feat/web-shell`, chained on `feat/backend-foundation` (feature-branch-chain). Each work-unit
commit gets its native review right after it is committed, to stay within the reviewer budget.

## Acceptance criteria
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` pass in `web/`.
- Unauthenticated visit to any app route redirects to `/login`; login/logout work against the backend
  contract (cookie session, generic 401, 429 with Retry-After message).
- Connections: secrets are never rendered back (only the hint); editing without a new secret keeps it.

## Checks
`cd web && pnpm lint && pnpm typecheck && pnpm test --run && pnpm build`

## Progress
- Branch `feat/web-shell` created from `feat/backend-foundation` (HEAD 2538f00).

- T1 done by delegated writer: Next 16.4 / React 19.3 (proxy.ts replaces middleware), Tailwind 4.3,
  TanStack Query 5, Vitest 5, MSW 3. RED: 9/9 test files failed to import; GREEN 67 tests; lint,
  typecheck, build pass; smoke: unauthenticated app routes 307 → /login?next=…
- Commits (split for review): `0514b8d` build — scaffold, tooling, lockfile (5.7k lines, unreviewed:
  generated); `e1a6a4a` design tokens + UI primitives (reviewed, approved; advisory: PasswordInput
  toggle, Button loading and IconButton type-level tests are missing/weak); next commit API client +
  auth + proxy (high risk, 4 lenses) → CRITICAL open redirect found: `next` values with dot segments
  (`/.//evil.com`) normalized into `//evil.com` after the checks. Corrected in `89424e2` (RED 4 tests →
  GREEN; validation approved; acknowledged). Then shell + routes commit with this document.
- Intermediate commits are tests+lint green; `typecheck`/`build` only pass on the full tree (login page
  imports the shell Brand).
- `web/.env.example` left UNCOMMITTED: parent cannot read `.env*` (deny rule); pending user check.
- Local run needs backend `WEB_ORIGINS=http://localhost:3000` and `SESSION_COOKIE_SECURE=false`; web
  `BACKEND_URL` is baked at build time.

- Shell commit `c031808` reviewed: medium, 688 lines, APPROVED + acknowledged. Full tree verified:
  lint, typecheck, 71 tests, build. Reviewed boundary = c031808. Advisory: AppShell test doesn't reset
  the redirectToLogin mock; mobile drawer stays open on non-link navigation (e.g. back button).

- T2 done by delegated writer (~1,800 authored lines, split in two commits). RED: 3 suites failed to
  import + 3 UI tests failed; GREEN 13 files / 102 tests (parent re-run 102); lint, typecheck, build pass.
  Edit sends only changed parts (config/secrets PATCH clears lastTest); secrets never pre-filled.
- Commit 1 (Dialog `actions`/`size` API, PasswordInput `subject`, connections data layer): reviewed,
  APPROVED + acknowledged (lineage review-d0c359e12e776260). Advisory: whitespace-only secret accepted as
  typed (form-schema.ts:130-133) — real bug, follow-up; errors/queries mappers untested; mock id
  collision after delete; Dialog test name mismatch. Commit 2: screen (containers, table, form, dialogs,
  tests, routes, README) + this document.
- Incident (2026-10-09): during visual-check cleanup the writer ran `lsof -ti tcp:3123 | xargs kill`,
  which also killed a Claude desktop network helper connected to that port (macOS restarted it). Rule:
  kill only the server PID. The Connections screen has NOT been checked in a real browser yet.
- Open risks: phone card layout may drop table semantics in Safari; server field errors persist until
  next submit; focus returns to body after delete; relative times don't refresh.

## Next step
Manual end-to-end check in a browser against the real backend (login → create/test connection), then
the voice run using a stored TTS connection.
