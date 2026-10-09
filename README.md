# voice-eval

voice-eval evaluates realtime voice agents. The `backend/` (Python, FastAPI, PostgreSQL) holds
the conversation probe and the platform API: users, sessions and encrypted provider
connections. The `frontend/` (Next.js) is the web console; the browser only talks to it, and it
proxies `/api/*` to the backend. The root `compose.yaml` runs the database, the backend and the
frontend together.

## Prerequisites

- Docker with Compose v2 (`docker compose version`).
- Network access while building: images are pulled, Python and Node packages are installed, and
  `next/font/google` downloads fonts during the frontend build.
- Port 3000 free on 127.0.0.1, or another port in `FRONTEND_PORT`.

## Run with Docker

```bash
cp .env.example .env
```

Fill in the two required values in `.env`:

- `POSTGRES_PASSWORD`: it is embedded in the backend's `DATABASE_URL`, so keep it URL-safe:
  `openssl rand -hex 24`.
- `VOICE_EVAL_MASTER_KEY`: a Fernet key that encrypts stored provider secrets:
  `openssl rand -base64 32 | tr '+/' '-_'` (or, from `backend/`,
  `uv run python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`).

Every `docker compose` command reads `.env` and refuses to run while a required value is
missing. Then:

```bash
docker compose up --build -d     # db -> backend (applies migrations) -> frontend, each waits for the previous to be healthy
docker compose ps                # all three should be "healthy"

# create the first user (there is no public sign-up); the password is prompted twice, 12+ characters
docker compose exec backend voice-eval create-user --email you@example.com --display-name "You"
```

Open http://localhost:3000 and sign in. Use `localhost`, not `127.0.0.1`: the backend accepts
logins only from the origins in `WEB_ORIGINS` (default `http://localhost:<FRONTEND_PORT>`).

| Task | Command |
| --- | --- |
| Follow logs | `docker compose logs -f` (or `docker compose logs -f backend`) |
| Stop, keep data | `docker compose down` |
| Rebuild after code changes | `docker compose up --build -d` |
| Reset everything (deletes the database volume) | `docker compose down -v` |
| Database shell | `docker compose exec db psql -U voice_eval -d voice_eval` |

Only the frontend is published to the host (127.0.0.1). To reach the database or the backend
directly, add a gitignored `compose.override.yaml` at the repository root; Compose merges it
automatically:

```yaml
services:
  db:
    ports:
      - "127.0.0.1:5432:5432"
  backend:
    ports:
      - "127.0.0.1:8080:8000"   # pick a free host port
```

### Configuration

| Variable (`.env`) | Default | Purpose |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | required | Database password, also used in `DATABASE_URL`. |
| `VOICE_EVAL_MASTER_KEY` | required | Fernet key(s) for provider secrets; comma-separated for rotation (see `backend/README.md`). |
| `FRONTEND_PORT` | `3000` | Host port of the frontend, bound to 127.0.0.1. |
| `ENVIRONMENT` | `production` | `development` serves `/docs`, lifts the SSRF guard for connection tests and accepts `http://localhost` URLs. |
| `POSTGRES_USER`, `POSTGRES_DB` | `voice_eval` | Database user and name. |
| `WEB_ORIGINS` | `http://localhost:<FRONTEND_PORT>` | Browser origins the backend accepts (comma-separated). |
| `SESSION_COOKIE_SECURE` | `false` | Marks the session cookie `Secure`; must be `true` behind HTTPS. |
| `FORWARDED_ALLOW_IPS` | `127.0.0.1` | Peers whose `X-Forwarded-For` the backend trusts (see "Client IPs"). |

The backend reads its settings only from these environment variables; no `.env` file is copied
into any image. Changing the frontend's backend address requires a rebuild: `BACKEND_URL` is a
build argument baked in by `next build`.

## Local development without Docker

- Backend: `backend/README.md` (uv, pytest; the database can still come from `docker compose up -d db`).
- Frontend: `frontend/README.md` (pnpm, Vitest).

## Security notes

- **Master key.** Keep `VOICE_EVAL_MASTER_KEY` out of version control and back it up: losing
  every key makes the stored provider secrets unrecoverable. The backend refuses to start
  without a valid key.
- **TLS.** The stack serves plain HTTP on 127.0.0.1 only. If you expose it, put a TLS-terminating
  reverse proxy in front of the frontend, set `SESSION_COOKIE_SECURE=true` and set `WEB_ORIGINS`
  to the public `https://` origin.
- **`ENVIRONMENT`.** Leave it at `production` unless you need `/docs` or need to test
  connections against local services: `development` loosens those checks.
- **Containers** run as non-root users (backend uid 10001 with a read-only root filesystem,
  frontend `node`), with `no-new-privileges`. The database and backend are not published to the
  host by default.
- **Client IPs.** The frontend's `/api/*` proxy (a Next.js rewrite) does not add the caller's
  address to `X-Forwarded-For`; it passes through whatever header the client sent. Trusting it
  would let any client pick the IP that login throttling counts, so by default the backend
  trusts no forwarded headers and every browser login counts against the frontend container's
  IP: 20 failed logins within 15 minutes, from anyone, block logins through the frontend for
  everyone until the window passes (the per-email limit still applies too). Only when a reverse
  proxy that you control sits in front of the frontend, is its only entry point, and appends
  the client address to `X-Forwarded-For`, set `FORWARDED_ALLOW_IPS` to the frontend
  container's address on the `voice-eval` network (`docker network inspect voice-eval`).
