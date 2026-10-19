# voice-eval

voice-eval evaluates realtime voice agents. The `backend/` (Python, FastAPI, PostgreSQL) holds
the conversation probe and the platform API: users, sessions and encrypted provider
connections. The `frontend/` (Next.js) is the web console. The root `compose.yaml` runs the
database, the backend and the frontend behind `edge/`, an NGINX reverse proxy that is the
browser's only entry point.

```text
browser ──► 127.0.0.1:${FRONTEND_PORT:-3000}
              │
              ▼
            edge (NGINX, fixed address EDGE_IPV4 on the compose network)
              ├── /api/, /api ──► backend:8000 (FastAPI) ──► db:5432 (PostgreSQL)
              └── everything else ──► frontend:3000 (Next.js)
```

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
- `VOICE_EVAL_MASTER_KEY`: any non-empty passphrase or Fernet key that encrypts stored provider secrets (passphrases are stretched with scrypt; a random key is recommended):
  `openssl rand -base64 32 | tr '+/' '-_'` (or, from `backend/`,
  `uv run python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`).

Every `docker compose` command reads `.env` and refuses to run while a required value is
missing. Then:

```bash
docker compose up --build -d     # db -> backend (applies migrations) -> frontend -> edge, each waits for the previous to be healthy
docker compose ps                # all four should be "healthy"

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
| Reset everything (deletes the database and run artifact volumes) | `docker compose down -v` |
| Database shell | `docker compose exec db psql -U voice_eval -d voice_eval` |
| Smoke test the running stack | `scripts/compose-smoke.sh` (see "Smoke test") |

Only the edge is published to the host (127.0.0.1). To reach the database or the backend
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
| `VOICE_EVAL_MASTER_KEY` | required | Passphrase(s) or Fernet key(s) for provider secrets; comma-separated for rotation (see `backend/README.md`). |
| `FRONTEND_PORT` | `3000` | Host port of the edge (the web console), bound to 127.0.0.1. |
| `ENVIRONMENT` | `production` | `development` lifts the SSRF guard for connection tests and accepts `http://localhost` URLs. The API docs are public in every environment: Swagger UI at `/api/docs`, schema at `/api/openapi.json`, agent skill at `/api/skill`. |
| `POSTGRES_USER`, `POSTGRES_DB` | `voice_eval` | Database user and name. |
| `WEB_ORIGINS` | `http://localhost:<FRONTEND_PORT>` | Browser origins the backend accepts (comma-separated). |
| `RUNS_MAX_CONCURRENCY` | `3` | Evaluator conversations running at once across every batch (each is a paid agent session). |
| `SESSION_COOKIE_SECURE` | `false` | Marks the session cookie `Secure`; must be `true` behind HTTPS. |
| `FORWARDED_ALLOW_IPS` | `EDGE_IPV4` | Peers whose `X-Forwarded-For` the backend trusts: exactly the edge (see "Client IPs"). |
| `PLATFORM_SUBNET` | `172.29.53.0/24` | Subnet of the compose network. |
| `PLATFORM_IP_RANGE` | `172.29.53.128/25` | Part of the subnet Docker assigns to the other containers; must not contain `EDGE_IPV4`. |
| `EDGE_IPV4` | `172.29.53.10` | The edge's fixed address, inside `PLATFORM_SUBNET` and outside `PLATFORM_IP_RANGE`. |

Run artifacts (both audio sides, transcript, events, summary) are kept in the `runs-data`
volume, mounted at `/data/runs` in the backend; they survive restarts and rebuilds.

The backend reads its settings only from these environment variables; no `.env` file is copied
into any image. Changing the frontend's backend address requires a rebuild: `BACKEND_URL` is a
build argument baked in by `next build`. In this stack the frontend's own `/api/*` rewrite is
unused (the edge routes `/api/` first); it serves local development without Docker.

If `172.29.53.0/24` collides with another network on your machine (`docker compose up` reports
an overlapping pool), change `PLATFORM_SUBNET`, `PLATFORM_IP_RANGE` and `EDGE_IPV4` together;
`FORWARDED_ALLOW_IPS` follows `EDGE_IPV4` unless you set it.

### Smoke test

`scripts/compose-smoke.sh` checks the stack the way a browser uses it, through the edge: health,
the frontend page, cookie login (HttpOnly), `/api/auth/me`, a `401` without a session, that a
forged `X-Forwarded-For` is never recorded as the client address (it compares the address in
`login_attempts` with the peer the edge logged), that a direct call to the backend from another
container is not trusted, and that locking out one client (the frontend container, through the
edge) does not lock out another (the host). It prints `PASS`/`FAIL` lines, exits non-zero on any
failure and never prints secrets.

```bash
scripts/compose-smoke.sh              # the regular stack (.env); starts it if needed, removes its test user afterwards
scripts/compose-smoke.sh --down       # same, then `docker compose down` (the database volume is kept)
scripts/compose-smoke.sh --ephemeral  # a throwaway stack: project voice-eval-smoke, port 3080 (SMOKE_PORT),
                                      # subnet 172.29.54.0/24, generated secrets, no .env; removed with `down -v`
```

From one host every request reaches the edge from the same peer address, so the lockout check
uses the frontend container as the second client: it proves that two peers are counted
separately, not that two public IPs are.

## Deploy on Dokploy

`compose.dokploy.yaml` runs the same stack behind Dokploy's Traefik: nothing is published on the
host, the edge joins `dokploy-network`, and Traefik terminates TLS.

1. Create a **Compose** service from this repository (branch `main`) with compose path
   `./compose.dokploy.yaml`.
2. In **Environment**, set:

   | Variable | Value |
   | --- | --- |
   | `POSTGRES_PASSWORD` | `openssl rand -hex 24` (URL-safe) |
   | `VOICE_EVAL_MASTER_KEY` | see "Run with Docker"; back it up outside Dokploy |
   | `WEB_ORIGINS` | the public origin, e.g. `https://duet.example.com` |
   | `TRUSTED_PROXY_CIDR` | the subnet of `dokploy-network`: `docker network inspect dokploy-network --format '{{(index .IPAM.Config 0).Subnet}}'` |

   `SESSION_COOKIE_SECURE` defaults to `true` here. If `172.29.53.0/24` collides with a network
   on the VPS, change `PLATFORM_SUBNET`, `PLATFORM_IP_RANGE` and `EDGE_IPV4` together.
3. In **Domains**, add the domain with service `edge`, port `8080` and HTTPS (Let's Encrypt).
   If it goes through Cloudflare, keep the record DNS only or disable caching: the UI language
   comes from a cookie, so shared caches would mix languages.
4. Deploy, then create the first user from the backend container (Dokploy's terminal, or
   `docker exec` on the VPS):

   ```bash
   voice-eval create-user --email you@example.com --display-name "You"
   ```

5. Back up the `db-data` and `runs-data` volumes (Dokploy's Volume Backups).

The edge trusts `X-Forwarded-For` only from `TRUSTED_PROXY_CIDR` (mounted into
`/etc/nginx/edge.d/`), so login throttling still counts real client addresses. Agents configured
on `localhost` resolve to the VPS itself.

## Local development without Docker

- Backend: `backend/README.md` (uv, pytest; the database can still come from `docker compose up -d db`).
- Frontend: `frontend/README.md` (pnpm, Vitest).

## Security notes

- **Master key.** Keep `VOICE_EVAL_MASTER_KEY` out of version control and back it up: losing
  every key makes the stored provider secrets unrecoverable. The backend refuses to start
  without a valid key.
- **TLS.** The stack serves plain HTTP on 127.0.0.1 only. If you expose it, put a TLS-terminating
  reverse proxy in front of the edge (see "Behind another proxy"), set
  `SESSION_COOKIE_SECURE=true` and set `WEB_ORIGINS` to the public `https://` origin.
- **`ENVIRONMENT`.** Leave it at `production` unless you need to test connections against
  local services: `development` loosens those checks.
- **Public docs.** `/api/docs` (Swagger UI), `/api/openapi.json` and `/api/skill(.zip)` are
  readable without credentials; every other `/api` route still needs a session or an API key.
- **Containers** run as non-root users (backend uid 10001 and edge uid 101 with read-only root
  filesystems, frontend `node`), with `no-new-privileges`; the edge also drops all capabilities.
  Only the edge is published to the host; the frontend, the backend and the database are not.
  The backend writes only to the `runs-data` volume (`/data/runs`).
- **Live streams.** The run WebSockets (`/api/runs/.../live`) authenticate with the session
  cookie and accept only the origins in `WEB_ORIGINS`. The edge passes WebSocket upgrades on
  `/api/` and keeps these routes open for up to an hour idle; other routes keep 300 s.
- **Client IPs.** The backend throttles failed logins per email and per client address (20
  failures in 15 minutes per address). The address must be the real peer and impossible to
  forge:
  - The edge is the first hop, so the address it sees (`$remote_addr`) is the client's. It
    *overwrites* `X-Forwarded-For` and `X-Real-IP` with it, sets `X-Forwarded-Proto` and
    `X-Forwarded-Host` from its own view and drops `X-Forwarded-Port` and `Forwarded`: whatever
    the client sent is discarded (`edge/nginx.conf`).
  - The backend (uvicorn `--proxy-headers`) trusts `X-Forwarded-For` only from
    `FORWARDED_ALLOW_IPS`, which defaults to the edge's fixed address (`EDGE_IPV4`). Any other
    peer, including the frontend container, is recorded as itself.
  - The frontend's Next.js rewrite passes a client's `X-Forwarded-For` through unchanged and adds
    no peer address, which is why the edge, not the frontend, sends `/api/` to the backend.
    Never add the frontend's address (or the whole subnet) to `FORWARDED_ALLOW_IPS`.

  Requests from the Docker host itself reach the edge from the compose network's gateway (with
  the defaults `172.29.53.128`, the first address of `PLATFORM_IP_RANGE`), so all local browsers
  share one counter; peers with other addresses are counted separately.
- **Behind another proxy.** If a load balancer or TLS terminator forwards to the edge, the edge
  sees that proxy as the peer, and every client would share its counter. Make the edge recover
  the client address from that proxy only, in the `http` block of `edge/nginx.conf`:

  ```nginx
  set_real_ip_from 10.0.0.5;          # your proxy's address (or its subnet); never 0.0.0.0/0
  real_ip_header   X-Forwarded-For;   # the header your proxy sets
  real_ip_recursive on;
  ```

  `$remote_addr` then becomes the client, and the edge still overwrites `X-Forwarded-For` with
  it, so `FORWARDED_ALLOW_IPS` stays the edge's address. Set `X-Forwarded-Proto` from the outer
  proxy's value as well (or hard-code `https`) if it terminates TLS, and publish the edge only
  to that proxy.
