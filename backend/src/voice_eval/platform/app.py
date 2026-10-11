"""FastAPI application factory. Everything under `/api` requires a session by default."""

import asyncio
import logging
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

from fastapi import APIRouter, Depends, FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from voice_eval.modules.agents import api as agents_api
from voice_eval.modules.connections import api as connections_api
from voice_eval.modules.runs import api as runs_api
from voice_eval.modules.runs import live_api as runs_live_api
from voice_eval.modules.runs.manager import RunManager
from voice_eval.modules.scenarios import api as scenarios_api
from voice_eval.modules.users import api as users_api
from voice_eval.modules.users import service as users_service
from voice_eval.modules.users.deps import current_principal
from voice_eval.platform.db import create_engine, create_sessionmaker
from voice_eval.platform.secrets import SecretBox
from voice_eval.platform.settings import Settings, get_settings

log = logging.getLogger(__name__)

HEALTH_DB_TIMEOUT_S = 3

health_router = APIRouter(tags=["platform"])


@health_router.get("/health")
async def health(request: Request) -> JSONResponse:
    try:
        async with asyncio.timeout(HEALTH_DB_TIMEOUT_S), request.app.state.engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # report, never leak connection details
        log.warning("health: database ping failed (%s)", type(exc).__name__)
        return JSONResponse({"status": "unavailable"}, status_code=503)
    return JSONResponse({"status": "ok"})


async def validation_error(_: Request, exc: Exception) -> JSONResponse:
    """422 with the location and message of each error, never the submitted value.

    FastAPI's default handler echoes the offending input, which may be a password or an API key.
    """
    errors = exc.errors() if isinstance(exc, RequestValidationError) else []
    detail = [{"type": e["type"], "loc": list(e["loc"]), "msg": e["msg"]} for e in errors]
    return JSONResponse({"detail": detail}, status_code=status.HTTP_422_UNPROCESSABLE_CONTENT)


def create_app(
    settings: Settings | None = None, *, extra_routers: Sequence[APIRouter] = ()
) -> FastAPI:
    """Build the app. `extra_routers` are mounted under `/api` behind authentication.

    Raises `MasterKeyError` when `VOICE_EVAL_MASTER_KEY` is missing or invalid.
    """
    settings = settings or get_settings()
    secret_box = SecretBox.from_settings(settings)  # fail fast, before anything is started
    engine = create_engine(settings.database_url)
    sessionmaker = create_sessionmaker(engine)
    runs = RunManager(
        sessionmaker,
        secret_box=secret_box,
        data_dir=settings.runs_data_dir,
        max_concurrency=settings.runs_max_concurrency,
        allow_local_http=settings.environment == "development",
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await users_service.warm_up()
        await runs.recover()
        yield
        await runs.shutdown()  # unfinished runs become `interrupted`, artifacts still written
        await engine.dispose()

    docs = settings.environment == "development"  # fail closed: anything else hides the docs
    app = FastAPI(
        title="voice-eval",
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.state.settings = settings
    app.state.secret_box = secret_box
    app.state.engine = engine
    app.state.sessionmaker = sessionmaker
    app.state.runs = runs
    app.add_exception_handler(RequestValidationError, validation_error)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.web_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Client"],
    )

    protected = APIRouter(dependencies=[Depends(current_principal)])
    protected.include_router(users_api.protected_router)
    protected.include_router(connections_api.router)
    protected.include_router(agents_api.router)
    protected.include_router(scenarios_api.router)
    protected.include_router(runs_api.router)
    for router in extra_routers:
        protected.include_router(router)

    api = APIRouter(prefix="/api")
    api.include_router(health_router)
    api.include_router(users_api.public_router)
    api.include_router(runs_live_api.router)  # WebSockets: authenticated by the handlers
    api.include_router(protected)
    app.include_router(api)
    return app
