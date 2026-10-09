#!/usr/bin/env bash
# Smoke test of the root compose stack through the edge, the way a browser reaches it.
#
#   scripts/compose-smoke.sh               # test the regular `voice-eval` stack (.env or env vars)
#   scripts/compose-smoke.sh --down        # ...then stop it (`docker compose down`, data kept)
#   scripts/compose-smoke.sh --ephemeral   # throwaway stack: own project, port, network, secrets;
#                                          # removed with its volume afterwards (`down -v`)
#
# Checks: health through the edge, cookie login, authentication, that a forged X-Forwarded-For is
# never recorded as the client address, and that one client's IP lockout does not lock out
# another client. Prints PASS/FAIL lines and exits non-zero on any failure. Never prints secrets.
#
# The regular mode creates a throwaway user and login attempts (emails `smoke-<run>...@example.com`)
# and deletes them before exiting.
#
# Ephemeral mode settings (environment, optional): SMOKE_PORT (default 3080), SMOKE_SUBNET
# (172.29.54.0/24), SMOKE_IP_RANGE (172.29.54.128/25), SMOKE_EDGE_IPV4 (172.29.54.10).

set -euo pipefail

usage() { sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; }

EPHEMERAL=0
DOWN=0
for arg in "$@"; do
  case "$arg" in
    --ephemeral) EPHEMERAL=1 ;;
    --down) DOWN=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."

for tool in docker curl openssl; do
  command -v "$tool" >/dev/null || { echo "FAIL  $tool is required" >&2; exit 1; }
done

COMPOSE_ARGS=()
if [ "$EPHEMERAL" = 1 ]; then
  # Isolated from the regular stack: another project (containers, network, volume), another host
  # port and subnet, and no `.env` (`--env-file /dev/null`): throwaway secrets, defaults otherwise.
  COMPOSE_ARGS=(--env-file /dev/null --project-name voice-eval-smoke)
  unset POSTGRES_USER POSTGRES_DB ENVIRONMENT WEB_ORIGINS SESSION_COOKIE_SECURE FORWARDED_ALLOW_IPS
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  VOICE_EVAL_MASTER_KEY="$(openssl rand -base64 32 | tr '+/' '-_')"
  FRONTEND_PORT="${SMOKE_PORT:-3080}"
  PLATFORM_SUBNET="${SMOKE_SUBNET:-172.29.54.0/24}"
  PLATFORM_IP_RANGE="${SMOKE_IP_RANGE:-172.29.54.128/25}"
  EDGE_IPV4="${SMOKE_EDGE_IPV4:-172.29.54.10}"
  export POSTGRES_PASSWORD VOICE_EVAL_MASTER_KEY FRONTEND_PORT PLATFORM_SUBNET PLATFORM_IP_RANGE EDGE_IPV4
fi

compose() { docker compose ${COMPOSE_ARGS[@]+"${COMPOSE_ARGS[@]}"} "$@"; }

# SQL comes from stdin; the database credentials stay inside the db container.
psql_db() {
  compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -X -q -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
}

FAILURES=0
pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILURES=$((FAILURES + 1)); }
die() { echo "FAIL  $*"; exit 1; }

RUN="$(openssl rand -hex 4)"
USER_EMAIL="smoke-${RUN}@example.com"
SPOOF_EMAIL="smoke-${RUN}-spoof@example.com"
FORGED_IP="203.0.113.9"
USER_AGENT="voice-eval-compose-smoke/${RUN}"
WORK="$(mktemp -d)"
STACK_UP=0

cleanup() {
  local status=$?
  set +e
  if [ "$STACK_UP" = 1 ]; then
    if [ "$EPHEMERAL" = 1 ]; then
      echo "----  removing the ephemeral stack and its volume"
      compose down -v --remove-orphans >"$WORK/down.log" 2>&1 || tail -n 20 "$WORK/down.log"
    else
      psql_db >/dev/null 2>&1 <<SQL
DELETE FROM login_attempts WHERE email LIKE 'smoke-${RUN}%';
DELETE FROM users WHERE email = '${USER_EMAIL}';
SQL
      if [ "$DOWN" = 1 ]; then
        echo "----  stopping the stack (data kept)"
        compose down >"$WORK/down.log" 2>&1 || tail -n 20 "$WORK/down.log"
      fi
    fi
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# --- configuration -------------------------------------------------------------------------------
if ! compose config -q 2>"$WORK/config.err"; then
  # Compose names the missing variable (POSTGRES_PASSWORD / VOICE_EVAL_MASTER_KEY); no values.
  cat "$WORK/config.err"
  die "compose configuration: set POSTGRES_PASSWORD and VOICE_EVAL_MASTER_KEY (environment or .env), or pass --ephemeral"
fi
pass "compose configuration resolves"

# --- start ---------------------------------------------------------------------------------------
echo "----  building and starting the stack ($([ "$EPHEMERAL" = 1 ] && echo ephemeral || echo regular)); this can take a few minutes"
STACK_UP=1
if ! compose up -d --build --wait >"$WORK/up.log" 2>&1; then
  tail -n 40 "$WORK/up.log"
  compose ps -a
  die "docker compose up --build --wait"
fi
pass "all services healthy (docker compose up --wait)"

EDGE_ADDR="$(compose port edge 8080)" || die "edge is not published"
BASE="http://${EDGE_ADDR}"
# A browser origin the backend accepts (the first of WEB_ORIGINS).
ORIGIN="$(compose exec -T backend sh -c 'printf %s "$WEB_ORIGINS"' | cut -d, -f1)"
container_ip() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$(compose ps -q "$1")"; }
EDGE_IP="$(container_ip edge)"
FRONTEND_IP="$(container_ip frontend)"
echo "----  edge ${BASE}, origin ${ORIGIN}, edge container ${EDGE_IP}, frontend container ${FRONTEND_IP}"

# http_status <out-prefix> <curl args...>: prints the status; body in <prefix>.body, headers in <prefix>.headers
http_status() {
  local prefix="$1"; shift
  curl -sS --max-time 20 -A "$USER_AGENT" -o "${prefix}.body" -D "${prefix}.headers" -w '%{http_code}' "$@" || true
}
expect_status() { # <label> <expected> <actual>
  if [ "$3" = "$2" ]; then pass "$1 -> $3"; else fail "$1 -> $3 (expected $2)"; fi
}

# --- edge routing --------------------------------------------------------------------------------
code="$(http_status "$WORK/health" "$BASE/api/health")"
if [ "$code" = 200 ] && grep -q '"status":"ok"' "$WORK/health.body"; then
  pass "GET /api/health through the edge -> 200 ok"
else
  fail "GET /api/health through the edge -> $code"
fi

code="$(http_status "$WORK/page" "$BASE/login")"
expect_status "GET /login (frontend) through the edge" 200 "$code"
server="$(grep -i '^server:' "$WORK/page.headers" | tr -d '\r' | cut -d' ' -f2- || true)"
if [ "$server" = "nginx" ]; then pass "Server header carries no version ($server)"; else fail "Server header: '$server'"; fi

# --- user and cookie login -----------------------------------------------------------------------
PASSWORD="$(openssl rand -hex 16)"
if printf '%s\n' "$PASSWORD" | compose exec -T backend voice-eval create-user \
  --email "$USER_EMAIL" --display-name "Compose smoke" --password-stdin >/dev/null 2>"$WORK/create.err"; then
  pass "create-user ${USER_EMAIL} (password from stdin)"
else
  cat "$WORK/create.err"
  die "create-user"
fi

login() { # <out-prefix> <email> <password> [extra curl args...]: body via stdin, never in argv
  local prefix="$1" email="$2" password="$3"; shift 3
  printf '{"email":"%s","password":"%s"}' "$email" "$password" | http_status "$prefix" \
    -X POST "$BASE/api/auth/login" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
    --data-binary @- "$@"
}

code="$(login "$WORK/login" "$USER_EMAIL" "$PASSWORD" -c "$WORK/cookies")"
expect_status "POST /api/auth/login (Origin $ORIGIN)" 200 "$code"
cookie="$(grep -i '^set-cookie: ve_session=' "$WORK/login.headers" | tr -d '\r' || true)"
if [ -n "$cookie" ] && printf '%s' "$cookie" | grep -qi '; *httponly'; then
  pass "session cookie ve_session is HttpOnly"
else
  fail "session cookie ve_session missing or not HttpOnly"
fi
if grep -q '"token"' "$WORK/login.body"; then fail "browser login response exposes a token"; fi

code="$(http_status "$WORK/me" -b "$WORK/cookies" "$BASE/api/auth/me")"
expect_status "GET /api/auth/me with the cookie" 200 "$code"
code="$(http_status "$WORK/anon" "$BASE/api/connections")"
expect_status "GET /api/connections without a session" 401 "$code"

# --- spoofing: a forged X-Forwarded-For must never be recorded ----------------------------------
for _ in 1 2; do
  code="$(login "$WORK/spoof" "$SPOOF_EMAIL" "wrong-password-${RUN}" \
    -H "X-Forwarded-For: $FORGED_IP" -H "X-Real-IP: $FORGED_IP" -H "Forwarded: for=$FORGED_IP")"
  expect_status "failed login with forged X-Forwarded-For: $FORGED_IP" 401 "$code"
done
recorded="$(printf "SELECT DISTINCT ip FROM login_attempts WHERE email = '%s';\n" "$SPOOF_EMAIL" | psql_db)"
# What the edge saw as the peer for this run's requests (first field of its access log).
seen="$(compose logs --no-log-prefix edge 2>/dev/null | grep -F "$USER_AGENT" | awk '{print $1}' | sort -u)"
echo "----  recorded client ip: '${recorded}'; edge-seen peer: '${seen}'"
if [ -z "$recorded" ]; then
  fail "no login attempt recorded for the spoof check"
elif [ "$(printf '%s\n' "$recorded" | wc -l | tr -d ' ')" != 1 ]; then
  fail "spoofed attempts recorded under several addresses: $(echo $recorded)"
elif [ "$recorded" = "$FORGED_IP" ]; then
  fail "backend recorded the forged address $FORGED_IP"
elif [ "$recorded" != "$seen" ]; then
  fail "recorded ip $recorded is not the edge-seen peer '$seen'"
else
  pass "forged $FORGED_IP ignored; recorded ip $recorded = peer seen by the edge"
fi
if [ -n "$recorded" ] && [ "$recorded" != "$EDGE_IP" ] && [ "$recorded" != "$FRONTEND_IP" ]; then
  pass "recorded ip $recorded is neither the edge ($EDGE_IP) nor the frontend ($FRONTEND_IP) container"
else
  fail "recorded ip '$recorded' is a proxy container address (edge $EDGE_IP, frontend $FRONTEND_IP)"
fi

# --- a second client: the frontend container, which is not a trusted proxy -----------------------
# login_from_frontend <url> <email-prefix> <max-attempts>: failed logins until the first 429;
# prints the status codes. Sends a forged X-Forwarded-For every time.
login_from_frontend() {
  compose exec -T frontend node -e '
    const [url, prefix, max, forged] = process.argv.slice(1);
    (async () => {
      const codes = [];
      for (let i = 0; i < Number(max); i++) {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": forged },
          body: JSON.stringify({ email: `${prefix}${i}@example.com`, password: "wrong-password-0" }),
        });
        codes.push(r.status);
        if (r.status === 429) break;
      }
      console.log(codes.join(" "));
    })().catch((e) => { console.error(String(e)); process.exit(1); });
  ' "$1" "$2" "$3" "$FORGED_IP"
}
ips_for() { printf "SELECT DISTINCT ip FROM login_attempts WHERE email LIKE '%s%%';\n" "$1" | psql_db; }

# Straight to the backend, bypassing the edge: uvicorn must not trust this peer's header.
codes="$(login_from_frontend "http://backend:8000/api/auth/login" "smoke-${RUN}-direct" 1)"
direct="$(ips_for "smoke-${RUN}-direct")"
if [ "$codes" = 401 ] && [ "$direct" = "$FRONTEND_IP" ]; then
  pass "direct backend call with forged X-Forwarded-For recorded as the caller ($direct): only the edge is trusted"
else
  fail "direct backend call: status '$codes', recorded '$(echo $direct)' (expected 401 and $FRONTEND_IP)"
fi

# Through the edge until this client is locked out (per-IP limit, 20 failures by default).
codes="$(login_from_frontend "http://edge:8080/api/auth/login" "smoke-${RUN}-b" 25)"
viaedge="$(ips_for "smoke-${RUN}-b")"
if [ "${codes##* }" = 429 ] && [ "$viaedge" = "$FRONTEND_IP" ]; then
  pass "client B ($viaedge) locked out after $(echo "$codes" | wc -w | tr -d ' ') attempts through the edge"
else
  fail "client B lockout: statuses '$codes', recorded '$(echo $viaedge)' (expected a final 429 and $FRONTEND_IP)"
fi

code="$(login "$WORK/login2" "$USER_EMAIL" "$PASSWORD")"
expect_status "client A ($recorded) still logs in while client B is locked out" 200 "$code"

# --- result --------------------------------------------------------------------------------------
echo "----  limitation: from one host every request shares one peer address; the second client is the"
echo "      frontend container, so the lockout check covers two distinct peers, not two public IPs."
if [ "$FAILURES" -gt 0 ]; then
  echo "FAIL  ${FAILURES} check(s) failed"
  exit 1
fi
echo "PASS  all checks passed"
