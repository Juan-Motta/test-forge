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

## Agents

`/agents` (`src/features/agents`) manages the voice agents under test through `/api/agents`:

- The list shows the protocol, the WebSocket host and channel ID, and whether a Langfuse
  connection is linked. Create and edit share one dialog: name, what the agent does (its shared
  context, used by every scenario), protocol, WebSocket URL, channel ID, user ID, optional
  Origin, and an optional Langfuse connection (only connections of kind `langfuse` are offered).
- Field rules mirror the backend (`wss://` with a host and no credentials, query or fragment;
  URL-path-safe channel IDs; an `http(s)` origin without a path). A `ws://localhost` URL is left
  for the server to judge, since it accepts one only in development; its 422 lands on the URL
  field. On edit, the PATCH carries only what changed, and a cleared Origin or Langfuse link is
  sent as `null`.
- "Import from cURL" (create and edit) reads a command copied from the browser's devtools
  (`curl 'wss://host/channelApi/{channelId}/realtime?userId=…' -H 'Origin: …'`) with the pure
  parser in `curl-import.ts`; nothing is executed. It fills only the fields it finds: WebSocket
  URL (scheme and host; `https`/`http` become `wss`/`ws`), channel ID, URL-decoded user ID and
  Origin (scheme, host and port). Name, context, protocol and Langfuse are never touched.
  `threadId` (generated per run), `voiceCapability` (added by the engine) and unknown query
  parameters are listed as ignored; other headers are dropped. Only a command without a usable
  URL is an error; a missing `userId` or a path other than `/channelApi/{channelId}/realtime`
  still fills the rest and shows a warning.
- Deleting asks for confirmation. While scenarios still use the agent the backend refuses with
  409 (`Agent is used by N scenario(s)`), shown in the dialog.

## Scenarios

`/scenarios`, `/scenarios/new` and `/scenarios/[id]` (`src/features/scenarios`) use
`/api/scenarios`:

- The library loads every scenario once and filters by agent and tag in the browser, grouped by
  agent. Duplicate calls `POST /api/scenarios/{id}/duplicate` and opens the copy. "New scenario"
  is disabled, with a link to Agents, until an agent exists. `/agents` also shows how many
  scenarios use each agent.
- Create and edit share one editor: target agent (with that agent's shared context shown
  read-only) and the scenario's own context, persona and evaluator voice (only `openai` and
  `azure_openai` connections), goal and behaviour, facts (keys unique, case-insensitive), weighted
  success criteria with a live total that must be exactly 100 before saving, and end conditions.
  Existing criterion ids are kept; new rows get theirs from the backend.
- On edit, the PATCH carries only the changed top-level fields; persona, facts, criteria and end
  conditions are sent whole because the backend replaces them whole. A cleared evaluator voice is
  sent as `null`. Server 422 locations (`facts.2.key`, `criteria.1.text`, `criteria`) land on the
  matching row or section, a 409 about the name on the name field, and focus moves to the first
  error. An unknown id shows a not-found state.
- Unsaved changes: the browser warns before closing or reloading the tab, and the sidebar links,
  the breadcrumb and Cancel ask before discarding (`Link`'s `onNavigate`). The App Router has no
  API to block browser back/forward between app pages, so that path is not guarded.
- With Cache Components, Next keeps visited pages alive (Activity). `/scenarios/new` is keyed by
  `useRouter().bfcacheId`, so a fresh visit starts blank while back/forward keeps the draft. The
  pathname of `/scenarios/[id]` is runtime data, so the shell's navigation reads it behind a
  Suspense boundary and the rest of the route is still prerendered.

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
- `src/features/<feature>/` screens by business area (`auth`, `shell`, `connections`, `agents`, `scenarios`): containers fetch and hold
  state, presentational components take props only.
- `src/ui/` design system: tokens live in `src/app/globals.css` (CSS variables mapped into the
  Tailwind theme) and atomic primitives (`Button`, `Field`, `Dialog`, …) build on them.
- `src/lib/` cross-cutting code: API client and query client, navigation helpers.
- Tests sit next to the code (`*.test.ts(x)`), with MSW (`src/test/server.ts`) mocking the API.
