#!/bin/sh
# Apply database migrations, then serve the API. Configuration comes from the environment.
set -eu

voice-eval migrate

# Uvicorn only trusts X-Forwarded-* from FORWARDED_ALLOW_IPS (default 127.0.0.1, i.e. nothing in
# compose). See the root README before widening it.
exec uvicorn voice_eval.platform.app:create_app \
  --factory \
  --host 0.0.0.0 \
  --port 8000 \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}" \
  --no-server-header
