# Duet web

Next.js (App Router) console for the voice-eval backend in `../backend`.

## Run locally

```bash
cd frontend
pnpm install
cp .env.example .env.local   # adjust if the backend is not on 127.0.0.1:8000
pnpm dev                     # http://localhost:3000
```

The backend must be running (see `backend/README.md`, "Backend API") and configured for the web
origin:

- `WEB_ORIGINS` must include the origin you open in the browser, e.g. `http://localhost:3000`.
  Every login and every cookie-authenticated POST/PUT/PATCH/DELETE with another `Origin` gets 403.
- `SESSION_COOKIE_SECURE=false` when the site is served over plain HTTP (local development),
  otherwise the browser drops the session cookie.

| Variable | Where | Default | Purpose |
| --- | --- | --- | --- |
| `BACKEND_URL` | server | `http://127.0.0.1:8000` | Target of the `/api/*` rewrite. Read when `next dev` starts and baked in by `next build`: rebuild after changing it. |
| `NEXT_PUBLIC_ENVIRONMENT_LABEL` | browser | `local` | Text of the sidebar environment badge (inlined at build time). |
| `SESSION_COOKIE_NAME` | server | `ve_session` | Must match the backend's session cookie name. |

## How it talks to the backend

- The browser only calls same-origin `/api/*`; `next.config.ts` rewrites it to `BACKEND_URL`.
  The session cookie (HttpOnly, SameSite=Lax) therefore stays first-party, and the backend's
  Origin check sees the web origin. In the root compose stack the edge (NGINX) serves that
  origin and routes `/api/` to the backend itself, so the rewrite is only used without Docker:
  it forwards a client's `X-Forwarded-For` unchanged, which the backend must not trust.
- `src/proxy.ts` redirects page requests without a session cookie to `/login?next=…`. That is UX
  only: a present cookie is never trusted, the backend authorizes every call.
- `apiFetch` (`src/lib/api`) normalizes failures into `ApiError` (`status`, `message`,
  `fieldErrors` from 422, `retryAfterSeconds` from 429). A 401 from anything but login sends the
  browser to `/login?next=<current path>`. `next` is always reduced to a same-origin path.
- Sign-out calls `POST /api/auth/logout`, then reloads into `/login` so no cached data survives.

## Connections

`/settings/connections` (`src/features/connections`) manages provider credentials through
`/api/connections`:

- Secrets are write-only. The form never pre-fills or displays one; the list shows only the
  backend's `secretHint` (`••••3a1c`). On edit, a blank (or whitespace-only) key field keeps the
  stored secret: the PATCH carries only what changed (`name`, `config`, `secrets`), because a new
  `config` or `secrets` clears the last test result. A typed key is sent exactly as typed, never
  trimmed: surrounding whitespace or anything but printable ASCII is a field error (keys travel
  in HTTP headers).
- Field rules (https URLs, identifiers, Azure region, exactly one of region or endpoint) are
  mirrored client-side for fast feedback; the backend still validates, and its 422 locations
  (`config.endpoint`, `secrets.apiKey`) map onto the same form fields until the user edits that
  field. A 409 about the name lands on the name; any other 409 is a form-level message.
- "Test connection" in the form tests the draft values (`POST /api/connections/test`), or the
  saved connection when editing with a blank key (`POST /api/connections/{id}/test`). The row
  action "Test" always tests the saved connection and refreshes its status; several rows can be
  tested at once.
- Saving and deleting ignore repeated clicks while a request is in flight. After a delete, focus
  moves to the page title. On phones the table restyles into cards and keeps explicit table
  roles.

## Container image

`next.config.ts` sets `output: "standalone"`, so `pnpm build` also writes `.next/standalone`
(a minimal `server.js` with only the traced dependencies). Run a local production build with
`node .next/standalone/server.js` after copying `.next/static` into `.next/standalone/.next/`;
`pnpm start` still works but warns that it is not meant for standalone output.

`frontend/Dockerfile` (Node 24 alpine, pnpm pinned by `packageManager` through corepack) installs
with `--frozen-lockfile`, builds, and ships only the standalone server, `.next/static` and
`public/` (kept in git by a `.gitkeep`), run by the unprivileged `node` user with telemetry
disabled. `BACKEND_URL` is a build argument (default
`http://backend:8000`, the compose service) because the rewrite is baked in at build time.
`next/font/google` downloads the fonts during `next build`, so the build needs network access.
The root `compose.yaml` builds and runs it behind the edge, without publishing it to the host;
see the root README.

## Scripts

`pnpm dev`, `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (Vitest;
`pnpm test --run` for a single pass). Type-level tests (`*.test-d.tsx`, `expectTypeOf` and
`@ts-expect-error`) are checked by `pnpm typecheck`, not run by Vitest.

## Layout

- `src/app/` routes: `login/` and the `(app)/` group (shell layout and section pages).
- `src/features/<feature>/` screens by business area (`auth`, `shell`, `connections`): containers fetch and hold
  state, presentational components take props only.
- `src/ui/` design system: tokens live in `src/app/globals.css` (CSS variables mapped into the
  Tailwind theme) and atomic primitives (`Button`, `Field`, `Dialog`, …) build on them.
- `src/lib/` cross-cutting code: API client and query client, navigation helpers.
- Tests sit next to the code (`*.test.ts(x)`), with MSW (`src/test/server.ts`) mocking the API.
