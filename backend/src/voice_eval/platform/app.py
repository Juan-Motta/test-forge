"""FastAPI application factory. Everything under `/api` requires a session or an API key by
default."""

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
from voice_eval.modules.api_keys import api as api_keys_api
from voice_eval.modules.apiflows import api as apiflows_api
from voice_eval.modules.apiflows.runs import FlowRunner
from voice_eval.modules.connections import api as connections_api
from voice_eval.modules.judgements import api as judgements_api
from voice_eval.modules.judgements.coordinator import JudgementCoordinator
from voice_eval.modules.pricing import api as pricing_api
from voice_eval.modules.runs import api as runs_api
from voice_eval.modules.runs import live_api as runs_live_api
from voice_eval.modules.runs.manager import RunManager
from voice_eval.modules.scenarios import api as scenarios_api
from voice_eval.modules.scenarios import groups_api as scenario_groups_api
from voice_eval.modules.skill import api as skill_api
from voice_eval.modules.stats import api as stats_api
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
    development = settings.environment == "development"
    judgements = JudgementCoordinator(
        sessionmaker,
        secret_box=secret_box,
        allow_local_http=development,
        allow_private=development,  # a local Langfuse, like the connection tester
    )
    runs = RunManager(
        sessionmaker,
        secret_box=secret_box,
        data_dir=settings.runs_data_dir,
        max_concurrency=settings.runs_max_concurrency,
        allow_local_http=development,
        judgements=judgements,
        local_target_host=settings.local_target_host,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await users_service.warm_up()
        await runs.recover()
        await judgements.recover()  # unfinished judgements are judged again
        yield
        await runs.shutdown()  # unfinished runs become `interrupted`, artifacts still written
        await judgements.shutdown()  # unfinished judgements stay so for the next start
        await engine.dispose()

    # Public API docs under /api (the edge only proxies /api to the backend), in every environment.
    app = FastAPI(
        title="voice-eval",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    app.state.secret_box = secret_box
    app.state.engine = engine
    app.state.sessionmaker = sessionmaker
    app.state.runs = runs
    app.state.judgements = judgements
    app.state.flow_runner = FlowRunner(
        secret_box=secret_box,
        allow_private=development,
        allow_local_http=development,
        local_target_host=settings.local_target_host,
    )
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
    protected.include_router(api_keys_api.router)
    protected.include_router(connections_api.router)
    protected.include_router(agents_api.router)
    protected.include_router(scenarios_api.router)
    protected.include_router(scenario_groups_api.router)
    protected.include_router(apiflows_api.apis_router)
    protected.include_router(apiflows_api.flows_router)
    protected.include_router(apiflows_api.runs_router)
    protected.include_router(runs_api.router)
    protected.include_router(judgements_api.router)
    protected.include_router(stats_api.router)
    protected.include_router(pricing_api.router)
    for router in extra_routers:
        protected.include_router(router)

    api = APIRouter(prefix="/api")
    api.include_router(health_router)
    api.include_router(users_api.public_router)
    api.include_router(skill_api.router)  # public: the agent skill documents the API
    api.include_router(runs_live_api.router)  # WebSockets: authenticated by the handlers
    api.include_router(protected)
    app.include_router(api)
    _document_bearer_auth(app)
    return app


PUBLIC_OPERATIONS = {
    ("get", "/api/health"),
    ("post", "/api/auth/login"),
    ("get", "/api/skill"),
    ("get", "/api/skill.zip"),
}


def _document_bearer_auth(app: FastAPI) -> None:
    """Add the Bearer scheme to the OpenAPI schema, so Swagger's "Authorize" takes an API key.

    Authentication is enforced by `current_principal`, which reads the header itself, so FastAPI
    does not infer a scheme: every operation needs it except the public ones, marked `[]`.
    """
    build = app.openapi

    def openapi() -> dict:
        if app.openapi_schema is not None:
            return app.openapi_schema
        schema = build()
        schema.setdefault("components", {})["securitySchemes"] = {
            "bearer": {
                "type": "http",
                "scheme": "bearer",
                "description": "An API key (`ve_…`) or a session token.",
            }
        }
        schema["security"] = [{"bearer": []}]
        for path, item in schema.get("paths", {}).items():
            for method, operation in item.items():
                if (method, path) in PUBLIC_OPERATIONS:
                    operation["security"] = []
        app.openapi_schema = schema
        return schema

    app.openapi = openapi  # type: ignore[method-assign]
