# voice-eval backend

Python backend for evaluating realtime voice agents. The first piece is `voice-probe`, which
holds one scripted conversation with a Vivi voice agent and records everything needed to
inspect turn-taking and latency.

The same package also holds the platform backend (FastAPI + PostgreSQL), described in
[Backend API](#backend-api) below.

## Target protocols

One endpoint, `wss://<host>/channelApi/<channelId>/realtime?voiceCapability=live-v1&userId=&threadId=`,
serves two protocols; the backend picks one from the agent's configuration.

| | Live (`live`) | Legacy realtime (`realtime`) |
| --- | --- | --- |
| Wire events | `voice.*` | OpenAI Realtime GA events, relayed |
| First frame | `voice.protocol` | `session.created` (carries the model) |
| Ready when | `voice.ready` | first `session.updated` |
| Who starts | agent greets first | **caller must start** (agent never speaks first) |
| Agent turn end | inferred: `--silence-gap-ms` without audio or caption changes | explicit: `response.created` → `response.done`, then `--settle-ms` of quiet |
| Caller text turns | not supported | `--text` (user message + `response.create`) |
| Ending | `voice.close`, server answers `voice.closed` | close the socket with code 1000 |

`--protocol auto` (default) reads the first frame and picks the adapter: `voice.*` means Live,
`session.*` means legacy. Force one with `--protocol live` or `--protocol realtime`.

On the legacy path the server closes the socket (1011) on any client event outside its
allow-list (`session.update`, `input_audio_buffer.*`, `conversation.item.create|delete|truncate`,
`response.create|cancel`), so the probe never sends `voice.*` events there. A tool call makes
the agent produce several responses in a row with `response.processing` ticks while the tool
runs; they all count as one agent turn.

## What the probe does

1. Connects with a fresh UUID4 `threadId` (also the Langfuse session id), detects the protocol,
   and waits for the session to be ready.
2. Streams caller audio like an open microphone: one 100 ms PCM16/24 kHz frame every 100 ms,
   silence when idle (the server runs its own VAD on this stream).
3. Live: waits for the agent's greeting. Legacy: the caller starts, unless `--agent-first`
   asks for an opening agent turn (one `response.create`).
4. For each caller turn, in command-line order: waits until the previous agent turn would have
   finished playing (see below), sends the speech plus 600 ms of silence, or the text message,
   then waits for the agent's reply to end.
5. Ends the session (see the table) and writes artifacts. Ctrl-C also ends the session
   gracefully and writes artifacts.

## Setup and tests

```bash
cd backend
uv sync
uv run pytest -q          # probe: in-process fakes; backend: Postgres via Docker (see Backend API)
uv run ruff check . && uv run ruff format --check .
```

## Running

Caller turns come from a TTS provider (`--say`), pre-recorded 24 kHz mono PCM16 WAV files
(`--caller-wav`, provider-free), or text messages (`--text`, legacy protocol only, no TTS
credentials needed). All three flags are repeatable and keep their command-line order.

```bash
uv run voice-probe \
  --base-url wss://<host> \
  --channel-id <channel-id> \
  --user-id <user-id> \
  --say "Hola, quiero consultar mi saldo" \
  --caller-wav ./fixtures/second-turn.wav

# legacy realtime agent, text only (no TTS provider needed)
uv run voice-probe --base-url wss://<host> --channel-id <channel-id> --user-id <user-id> \
  --text "Hola, quiero consultar mi saldo" --text "Gracias, eso es todo"
```

Useful options: `--protocol auto|live|realtime`, `--agent-first`, `--origin <url>`,
`--thread-id <uuid>`, `--silence-gap-ms 900` (Live), `--settle-ms 1200` (legacy),
`--turn-timeout-s 30`, `--max-seconds 180`, `--playback-grace-ms 400`, `--no-playback-wait`,
`--out <dir>`, `-v`.

### Waiting for agent playback

Agents send reply audio much faster than real time. On the first real call against dev, a
21.3 s reply arrived within about 3.8 s; the turn ended on `response.done` and the probe spoke
again at about 17 s, while a real listener would still have heard the agent until about 30.5 s.
That is an interruption a phone caller would never make.

So before each caller turn the probe waits until the previous agent turn would have finished
playing: playback end = `first_audio_ms` + `audio_ms` (the audio plays back-to-back from its
first delta), plus `--playback-grace-ms` (default 400). It waits for whichever is later, the turn
end as detected today or that playback end, and keeps streaming silence meanwhile. Both protocols
behave the same. The wait is bounded: after `--turn-timeout-s` the caller speaks anyway (with a
warning), and `--max-seconds` stops the run. `--no-playback-wait` restores the old behavior
(speak right after the turn end), for fast runs.

`--text` against a Live target fails: with `--protocol live` before connecting (exit 2), with
`auto` right after detection, before any caller input is sent (exit 1, warning in the summary).

### TTS provider configuration (only needed for `--say`)

| Variable | Provider | Default |
| --- | --- | --- |
| `VOICE_EVAL_PROVIDER` | all: `openai`, `azure` (`azure_speech` is planned, not implemented) | `openai` |
| `OPENAI_API_KEY` | openai | required |
| `VOICE_EVAL_TTS_MODEL` | openai | `gpt-4o-mini-tts` |
| `VOICE_EVAL_TTS_VOICE` | openai, azure | `alloy` |
| `AZURE_OPENAI_API_KEY` | azure | required |
| `AZURE_OPENAI_ENDPOINT` | azure | required, e.g. `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_API_VERSION` | azure | required |
| `AZURE_OPENAI_TTS_DEPLOYMENT` | azure | required (deployment name) |

Speech is requested as `response_format="pcm"` (raw 24 kHz 16-bit mono), the target's wire format.

## Artifacts (`runs/<timestamp>-<threadId8>/` by default)

- `events.jsonl`: every received event (`dir: in`) with a monotonic `t_ms` offset, plus the
  probe's own actions (`dir: out`: `caller.text`, `caller.request_agent_turn`, `voice.close` or
  `websocket.close`). Audio deltas and binary frames are logged as byte counts only.
- `agent.wav`: concatenated agent audio (gaps between turns are not preserved).
- `caller.wav`: exactly what was sent, silence included.
- `transcript.json`: user/assistant messages. Live: captions ordered by `startMs`. Legacy:
  conversation-item order; assistant text from `response.output_audio_transcript.done` (deltas
  as fallback), user text from `conversation.item.input_audio_transcription.completed`, and
  `--text` turns as sent.
- `summary.json`: `protocol`, `model` (legacy), thread/session ids, `playback_wait`,
  `playback_grace_ms`, per-turn timings (`first_audio_ms`, `end_ms`, `audio_ms`,
  `playback_end_ms`, `caller_resumed_ms`: when the next caller turn actually started), latency,
  `response_count`, `tool_activity`, `end_reason` (legacy fields are `null` on Live), close
  code, usage (Live only).

## Known limitations

- Legacy: an agent turn ends `--settle-ms` after the last `response.done` with no new
  `response.created` or `response.processing`. A tool call whose next response starts later
  than that is split into two turns. If response events go missing, 5 s without agent
  activity ends the turn (`end_reason: fallback_gap`).
- The Live protocol has no response-done event. An agent turn ends after `--silence-gap-ms`
  without new agent audio or caption changes. A mid-reply pause longer than the gap (for example
  while a tool runs) is counted as a turn end, and the next utterance may overlap the agent.
- Latency is measured from the moment the caller's last speech frame (or the text message) is
  sent to the first agent audio delta of the turn. Trailing silence inside the TTS output is counted as speech, and network
  transit is included.
- Agent audio may arrive faster than real time, so turn end reflects delivery, not playback;
  the caller's playback wait accounts for that, but it assumes the agent never pauses
  mid-turn (a pause would push the real playback end later than the estimate).

## Backend API

FastAPI app over PostgreSQL 17 (SQLAlchemy 2 async + asyncpg, Alembic migrations). Layout:
`voice_eval/platform/` (settings, database, app factory, migrations) and one package per
business module under `voice_eval/modules/` (`users`, `connections`, `agents`,
`scenarios`).

### Running locally

To run the whole platform in containers, use the root `compose.yaml` (see the root README). To
run the backend from source, start only the database from the repository root and publish its
port with a local, gitignored `compose.override.yaml`:

```yaml
# compose.override.yaml (repository root)
services:
  db:
    ports:
      - "127.0.0.1:5432:5432"
```

```bash
# repository root: the root .env must exist (cp .env.example .env, then fill it in)
docker compose up -d db              # PostgreSQL 17 on 127.0.0.1:5432

cd backend
cp .env.example .env                 # placeholders; adjust as needed
# DATABASE_URL must use the root .env's POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB, e.g.
#   postgresql+asyncpg://voice_eval:<POSTGRES_PASSWORD>@127.0.0.1:5432/voice_eval
# put a master key in .env as VOICE_EVAL_MASTER_KEY (see Provider connections)
uv run python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
uv run voice-eval migrate            # alembic upgrade head
uv run voice-eval create-user --email you@example.com --display-name "You"
uv run uvicorn voice_eval.platform.app:create_app --factory --reload
```

The previous `backend/docker-compose.yml` (service `postgres`, password `voice_eval`) is gone;
its data stays in its old named volume (`docker volume ls`) until you remove it.

`voice-eval` failures print a single `error: ...` line, never a traceback, URL or password, and
exit with `1` (invalid input, e.g. a duplicate email), `2` (invalid or missing settings) or `3`
(the database failed or is unreachable).

Settings come from the environment or `backend/.env` (located from the package, so the working
directory does not matter; environment variables win over the file); `.env.example` documents
each one. The file is optional: the container image has none and is configured only through
environment variables. The project must stay installed from its source tree (editable, uv's
default), because `.env` and `alembic.ini` are found relative to it.
`DATABASE_URL` must use `postgresql+asyncpg://`. `ENVIRONMENT` defaults to `production`
(fail closed): `/docs` and `/openapi.json` are served only when it is exactly `development`, so
set `ENVIRONMENT=development` in your local `.env` if you want them. `SESSION_COOKIE_SECURE`
stays `true` unless explicitly set to `false` (needed for plain-HTTP local development).

### Authentication

- No public sign-up. `voice-eval create-user` prompts for the password twice
  (`--password-stdin` reads one line from stdin for automation). Minimum 12 characters.
  Emails are canonicalized once, the same way for sign-up, login and throttling:
  email-validator's normalized form (NFC local part, IDN domain in Unicode) lowercased.
- Passwords are hashed with argon2id; outdated parameters are re-hashed on the next login.
- `POST /api/auth/login` `{email, password}` opens a server-side session and sets the
  `ve_session` cookie (HttpOnly, SameSite=Lax, Secure unless `SESSION_COOKIE_SECURE=false`,
  `Max-Age` = `SESSION_TTL_HOURS`). The body is `{user, expiresAt}`; the raw token is added as
  `token` only when the request carries `X-Client: cli`. Every failure (unknown email, wrong
  password, inactive user) is the same `401 Invalid email or password`, and a password hash is
  verified on every path so timing does not reveal which emails exist (an address that is not
  even valid behaves like an unknown one). Verification runs in a worker thread with no
  database transaction open.
- Login throttling (stored in PostgreSQL, so it holds across worker processes): after
  `LOGIN_MAX_FAILURES_PER_EMAIL` (5) failures for an email, or `LOGIN_MAX_FAILURES_PER_IP` (20)
  for a client IP, within `LOGIN_WINDOW_MINUTES` (15), login answers
  `429 Too many login attempts, try again later` with `Retry-After` (seconds until the oldest
  counted failure leaves the window), before any password is checked and identically for
  known and unknown emails. A successful login resets the email counter (not the IP one).
  Attempts are kept 24 h. Behind a reverse proxy, run uvicorn with `--proxy-headers` (and
  `--forwarded-allow-ips`) or every client shares the proxy's IP counter. In the root compose
  stack, browsers reach the backend through the edge (NGINX), which overwrites
  `X-Forwarded-For` with the peer it sees; the backend trusts that header only from the edge's
  fixed address (see "Client IPs" in the root README).
- `POST /api/auth/logout` revokes the current session and clears the cookie.
  `GET /api/auth/me` returns the current user.
- Session tokens are 256-bit random values; only their SHA-256 hash is stored. Sessions expire
  after `SESSION_TTL_HOURS` (fixed, not sliding) and stop working when the user is deactivated.
  Activity (`last_seen_at`) is recorded at most once a minute. Every login attempt that reaches
  password verification also deletes up to 500 expired sessions.
- Everything under `/api` requires a session except `/api/health` and `/api/auth/login`.
  The cookie is checked first, then `Authorization: Bearer <token>`. Failures are `401` with
  `WWW-Authenticate: Bearer`.
- CSRF baseline: besides SameSite=Lax, a cookie-authenticated `POST/PUT/PATCH/DELETE` (and any
  login) whose `Origin` header is present but not in `WEB_ORIGINS` gets `403`. Bearer requests
  skip this check. CORS allows only `WEB_ORIGINS`, with credentials.

```bash
curl -s -H 'X-Client: cli' -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"..."}' http://localhost:8000/api/auth/login
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/auth/me
```

`GET /api/health` returns `{"status": "ok"}` after a database ping, or `503
{"status": "unavailable"}`.

Validation errors are `422 {"detail": [{type, loc, msg}]}`, whether the request shape or a
module's own rules rejected the input: the submitted value is never echoed back (it may be a
password or an API key).

### Provider connections

Provider credentials (OpenAI, Azure OpenAI, Azure AI Speech, Langfuse) are managed through the
API, stored in PostgreSQL with the secret part encrypted, and read again by every run, so an
edit applies to the next run without restarting anything.

| Kind | `config` (camelCase) | `secrets` |
| --- | --- | --- |
| `openai` | `baseUrl` (default `https://api.openai.com/v1`), `ttsModel` (`gpt-4o-mini-tts`), `ttsVoice` (`alloy`), `chatModel` (`gpt-4.1-mini`, the evaluator's model) | `apiKey` |
| `azure_openai` | `endpoint`, `apiVersion`, `ttsDeployment`, `ttsVoice` (`alloy`), `chatDeployment` (optional; without it the connection cannot be the evaluator) | `apiKey` |
| `azure_speech` | exactly one of `region` (e.g. `eastus`) or `endpoint`; `voice` (e.g. `es-MX-DaliaNeural`) | `key` |
| `langfuse` | `host`, `publicKey` | `secretKey` |

- `GET /api/connections`, `GET /api/connections/{id}`, `POST /api/connections`
  `{name, kind, config, secrets}` (201), `PATCH /api/connections/{id}` `{name?, config?,
  secrets?}`, `DELETE /api/connections/{id}` (204). A PATCH `config` or `secrets` replaces the
  whole object; omitting `secrets` keeps the stored ones; `kind` cannot change. Names are unique
  (409 `Connection name already in use`); a write that lost a race with another change (e.g.
  the creating user was deleted) is also 409 with a different message. Unknown ids are 404.
- Responses are `{id, name, kind, config, secretHint, hasSecret, lastTest, createdAt,
  updatedAt}`. Secrets are write-only: no response, log line or error message contains them;
  `secretHint` is `••••` plus the last 4 characters (only for secrets of 12+ characters).
  Secrets are sent as HTTP headers, so they must be printable ASCII without spaces or line
  breaks (422 otherwise).
- `POST /api/connections/{id}/test` tests the stored credentials and records `lastTest`
  `{at, ok, detail}`; `POST /api/connections/test` `{kind, config, secrets}` tests a draft and
  stores nothing. Each test is one authenticated request (OpenAI `GET {baseUrl}/models`, Azure
  OpenAI `GET {endpoint}/openai/models`, Azure AI Speech `POST .../sts/v1.0/issueToken`, Langfuse
  `GET {host}/api/public/projects`) with a 10 s timeout. Redirects are not followed and the
  response body is never read: `detail` is only the status code and a generic reason. Changing
  `config` or `secrets` clears `lastTest`. A test whose row is edited or deleted while the
  provider call is in flight returns its result but does not record it.
- Tests only reach public addresses (SSRF guard, `voice_eval.platform.egress`): the host is
  resolved once, the request is refused (`Destination not allowed (not a public address)`) if
  any resolved address is loopback, private, link-local, multicast, reserved, unspecified or
  otherwise not globally routable (IPv4 and IPv6, IPv4-mapped included), and the connection then
  goes to the vetted address, so DNS rebinding cannot swap it. `ENVIRONMENT=development` lifts
  the guard to test local services. Proxy variables and `.netrc` are ignored.
- URLs must be `https`, without credentials, query string or fragment. `http://localhost` and
  `http://127.0.0.1` are accepted only when `ENVIRONMENT=development`.
- Runs build their provider with `voice_eval.modules.connections.runtime.build_synthesizer`,
  which loads the current row on every call (no cache).

**Master key.** `VOICE_EVAL_MASTER_KEY` holds one or more comma-separated keys (Fernet keys, or any passphrase derived into one with scrypt); the API
refuses to start without a valid one (the CLI does not need it). Generate one with
`python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'`.
The first key encrypts and every key decrypts, so to rotate: prepend a new key
(`VOICE_EVAL_MASTER_KEY=<new>,<old>`), restart, re-save each connection's secrets, then drop the
old key. Losing every key makes stored secrets unrecoverable (re-enter them). Each ciphertext
is bound to its row id and kind, so it cannot be copied onto another connection.

### Agents

The voice agents under test. An agent stores how to reach it; every run opens the session with
a fresh UUID4 `threadId` (`voice_eval.modules.agents.domain.target_spec` builds the probe's
`TargetSpec`), so the thread id is never stored.

- `GET /api/agents` (ordered by name), `GET /api/agents/{id}`, `POST /api/agents` (201),
  `PATCH /api/agents/{id}` (partial: only the fields present change; `null` clears `origin` or
  `langfuseConnectionId`), `DELETE /api/agents/{id}` (204). Names are unique (409
  `Agent name already in use`); unknown ids are 404.
- Body and response fields: `name` (1-120), `context` (what the agent does, applies to all its
  scenarios; up to 20000 characters, may be empty), `protocol` (`auto` default, `live`,
  `realtime`), `baseUrl`, `channelId`, `userId`, `origin`, `langfuseConnectionId`; responses add
  `id`, `createdAt`, `updatedAt`.
- `baseUrl` must be `wss://` with a host and no credentials, query string, fragment or spaces
  (`ws://localhost` and `ws://127.0.0.1` only when `ENVIRONMENT=development`). `channelId`
  (up to 200) allows only URL-path-safe characters (`A-Z a-z 0-9 . _ ~ -`); `userId` (up to 200)
  is any printable text and is URL-encoded when used. `origin` is optional and must be an
  `http(s)` origin: scheme, host and port only.
- `langfuseConnectionId` must reference a connection of kind `langfuse` (422 otherwise);
  deleting that connection clears the reference.
- An agent that scenarios still reference cannot be deleted: 409 `Agent is used by N
  scenario(s)`.

### Scenarios

What the simulated caller is, knows and wants, and how the call is judged. Context is
two-level: the agent's `context` applies to all its scenarios, the scenario's adds to it.

- `GET /api/scenarios?agentId=&tag=` (both filters optional; most recently updated first),
  `GET /api/scenarios/{id}`, `POST /api/scenarios` (201), `PATCH /api/scenarios/{id}` (partial;
  `persona`, `facts`, `criteria` and `endConditions` are replaced as whole objects, so omitted
  inner fields take their defaults; `null` clears only `ttsConnectionId`, `evaluatorConnectionId` and `voiceOverride`),
  `DELETE /api/scenarios/{id}` (204), `POST /api/scenarios/{id}/duplicate` (201; same agent,
  named `<name> (copy)`, then `(copy 2)`, `(copy 3)`...).
- Names are unique per agent (409 `Scenario name already in use for this agent`); the same name
  may exist under other agents. Unknown ids are 404; an unknown `agentId` in a body is 422.
- Fields: `agentId`, `name` (1-160), `tags` (up to 20, each 1-40, trimmed and de-duplicated),
  `context` (up to 20000), `persona` `{name (1-120), locale (BCP 47-like, e.g. es-MX),
  temperament (polite|hurried|skeptical|confused|angry|friendly|calm|detailed), notes (up to
  2000)}`, `ttsConnectionId` (the evaluator voice: an `openai` or `azure_openai` connection, 422
  otherwise; deleting it clears the reference), `evaluatorConnectionId` (the chat model that
  plays the caller: an `openai` connection or an `azure_openai` one with a `chatDeployment`, 422
  otherwise; deleting it clears the reference; when null the voice connection is used if it can
  chat, otherwise the scenario cannot run), `voiceOverride` (optional voice id),
  `goal` (1-5000), `instructions` (up to 10000), `facts` (up to 50 `{key (1-80), value
  (1-500)}`, keys unique; revealed only when asked), `criteria` (1-30 `{id, text (1-500),
  kind (must|should), source (transcript|trace|timing), weight (1-100)}`, weights must total
  exactly 100; `id` is generated when missing and kept afterwards), `endConditions`
  `{maxDurationS (30-1800, default 360), maxSilenceS (5-120, default 15), hangUpWhen
  (goal_or_goodbye default, goodbye, max_duration)}`. Responses add `id`, `agent: {id, name}`,
  `createdAt`, `updatedAt`.

### Container image

`backend/Dockerfile` builds a multi-stage image (uv, Python 3.13 slim): dependencies are synced
from `uv.lock` without dev packages in a cached layer, then the project is installed editable at
`/app`. The runtime stage has no uv or build tools and runs as the unprivileged user `app`
(uid 10001). `docker-entrypoint.sh` runs `voice-eval migrate`, then
`uvicorn voice_eval.platform.app:create_app --factory` on `0.0.0.0:8000` with `--proxy-headers`,
trusting `X-Forwarded-*` only from `FORWARDED_ALLOW_IPS` (default `127.0.0.1`; the root compose
stack sets it to the edge's address, `EDGE_IPV4`). The health check
calls `/api/health` with the Python standard library.

### Tests

The backend tests start a throwaway `postgres:17` container with testcontainers (Docker must be
running), migrate it once per session and empty the tables before each test. Without a Docker
daemon they are skipped with the reason shown; the probe tests still run.
