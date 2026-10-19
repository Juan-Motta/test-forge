# syntax=docker/dockerfile:1

# voice-eval edge: the only service published to the host. NGINX (unprivileged image, uid 101,
# listening on 8080) routes `/api/` to the backend and everything else to the frontend, and
# rewrites the X-Forwarded-* headers from its own view of the connection (see nginx.conf).
# Build from edge/: `docker build -t voice-eval-edge .`

ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.5-alpine-slim

FROM ${NGINX_IMAGE}

# The stock server block is not used: nginx.conf includes no conf.d. Removing it also keeps the
# entrypoint's IPv6 helper from trying to edit it on a read-only root filesystem.
USER root
RUN rm -f /etc/nginx/conf.d/default.conf
# Runs before nginx starts (see nginx.conf, "Deployment-specific settings").
COPY --chown=root:root --chmod=0755 40-trusted-proxy.sh /docker-entrypoint.d/40-trusted-proxy.sh
# Owned by root and read-only for the nginx user.
COPY --chown=root:root --chmod=0644 nginx.conf /etc/nginx/nginx.conf
USER 101

EXPOSE 8080

# A loopback-only server (port 8081) answers the health check; it is not reachable from outside
# the container.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8081/healthz"]
