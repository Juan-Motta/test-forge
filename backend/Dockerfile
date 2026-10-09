# syntax=docker/dockerfile:1

# voice-eval backend (FastAPI + Alembic). Build from backend/: `docker build -t voice-eval-backend .`
# Configuration comes only from environment variables (see the root compose.yaml); no `.env` file
# and no secret is copied into the image.

ARG PYTHON_VERSION=3.13
ARG UV_VERSION=0.12

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# --- build: resolve the locked environment into /app/.venv -------------------------------------
FROM python:${PYTHON_VERSION}-slim AS build

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    UV_NO_INSTALLER_METADATA=1

WORKDIR /app

# Third-party dependencies first: this layer is reused until uv.lock or pyproject.toml change.
RUN --mount=from=uv,source=/uv,target=/bin/uv \
    --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-dev --no-install-project

# The project itself, installed editable (uv's default): settings and Alembic locate `.env` and
# `alembic.ini` relative to the source tree, so the tree stays at /app in the final image.
COPY pyproject.toml uv.lock README.md alembic.ini ./
COPY migrations ./migrations
COPY src ./src
RUN --mount=from=uv,source=/uv,target=/bin/uv \
    --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# --- runtime: no uv, no build tools, non-root ---------------------------------------------------
FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --home-dir /nonexistent \
       --shell /usr/sbin/nologin app

WORKDIR /app
# Owned by root and read-only for the app user.
COPY --from=build /app /app
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

USER app
EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=5 \
    CMD ["python", "-c", "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"]

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
