# syntax=docker/dockerfile:1

# voice-eval frontend (Next.js standalone server). Build from frontend/:
#   docker build --build-arg BACKEND_URL=http://backend:8000 -t voice-eval-frontend .
# The `/api/*` rewrite target is baked in by `next build`, so BACKEND_URL is a build argument:
# rebuild the image to change it. `next/font/google` downloads the fonts during the build, so the
# build needs network access.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app

# --- deps: install from the lockfile with the pnpm version pinned in package.json ---------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# --- build: standalone output --------------------------------------------------------------------
FROM deps AS build
ARG BACKEND_URL=http://backend:8000
ENV BACKEND_URL=${BACKEND_URL}
COPY . .
RUN pnpm build

# --- runtime: only the standalone server and static assets, non-root -----------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app

# Owned by root and read-only for the `node` user (uid 1000) that runs the server.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
# Files served as-is from `/` (favicon, robots.txt, ...). The directory always exists (it holds a
# .gitkeep), so this copy never fails when it has no assets.
COPY --from=build /app/public ./public
# The server may write its runtime cache; that directory is the only writable one.
RUN mkdir -p .next/cache && chown node:node .next/cache

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "server.js"]
