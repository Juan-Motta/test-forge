"""Running flows and reading their runs. `FlowRunner` lives on the app (tests swap its parts)."""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.apiflows import service
from voice_eval.modules.apiflows.ai import chat_generator
from voice_eval.modules.apiflows.domain import FlowNotFound, Header
from voice_eval.modules.apiflows.models import ApiRecord, FlowRecord, FlowRunRecord
from voice_eval.modules.apiflows.runner import (
    STEP_TIMEOUT_S,
    USER_AGENT,
    FlowInputError,
    Generator,
    curl,
    needs_generation,
    preview_inputs,
    preview_requests,
    resolve_inputs,
    run_flow,
)
from voice_eval.modules.connections import runtime
from voice_eval.platform.egress import guarded_transport
from voice_eval.platform.secrets import SecretBox
from voice_eval.targets.connection import dial_base_url

MAX_LISTED_RUNS = 50


class FlowRunNotFound(Exception):
    pass


class StepNotFound(Exception):
    pass


@dataclass(frozen=True)
class FlowRun:
    id: uuid.UUID
    flow_id: uuid.UUID
    status: str
    inputs: list[dict[str, Any]]
    steps: list[dict[str, Any]]
    duration_ms: int
    created_at: datetime


def _run(record: FlowRunRecord) -> FlowRun:
    return FlowRun(
        id=record.id,
        flow_id=record.flow_id,
        status=record.status,
        inputs=record.inputs,
        steps=record.steps,
        duration_ms=record.duration_ms,
        created_at=record.created_at,
    )


GeneratorFactory = Callable[
    [AsyncSession, FlowRecord, uuid.UUID | None], Awaitable[Generator | None]
]


class FlowRunner:
    def __init__(
        self,
        *,
        secret_box: SecretBox,
        allow_private: bool,
        allow_local_http: bool,
        local_target_host: str | None,
    ) -> None:
        self.secret_box = secret_box
        self.allow_private = allow_private
        self.allow_local_http = allow_local_http
        self.local_target_host = local_target_host
        # Swappable in tests.
        self.transport: Callable[[], httpx.AsyncBaseTransport] = lambda: guarded_transport(
            allow_private=self.allow_private
        )
        self.build_generator: GeneratorFactory = self._chat_generator

    async def _chat_generator(
        self, db: AsyncSession, flow: FlowRecord, connection_id: uuid.UUID | None
    ) -> Generator | None:
        """None when no connection can write values (inputs that need one are then refused)."""
        connection_id = connection_id or await runtime.first_chat_connection(db)
        if connection_id is None:
            return None
        client, model = await runtime.build_chat_client(
            db,
            connection_id,
            secret_box=self.secret_box,
            allow_local_http=self.allow_local_http,
        )
        return chat_generator(client, model, flow_name=flow.name, flow_description=flow.description)

    async def run(
        self,
        db: AsyncSession,
        flow_id: uuid.UUID,
        *,
        inputs: dict[str, Any],
        connection_id: uuid.UUID | None,
        created_by: uuid.UUID | None,
    ) -> FlowRun:
        """Runs the flow now and stores the run. Raises `FlowNotFound`, `FlowInputError`,
        `GenerationError`, connection errors when AI must write inputs, and
        `SecretDecryptionError`."""
        flow = await db.get(FlowRecord, flow_id, populate_existing=True)
        if flow is None:
            raise FlowNotFound(str(flow_id))
        domain = await service.get_flow(db, flow_id)
        api: ApiRecord = flow.api
        needs_ai = needs_generation(domain.inputs, inputs)
        generator = await self.build_generator(db, flow, connection_id) if needs_ai else None
        resolved = await resolve_inputs(domain.inputs, inputs, generator)
        secrets = service.open_secrets(self.secret_box, api)
        async with httpx.AsyncClient(
            transport=self.transport(),
            timeout=STEP_TIMEOUT_S,
            follow_redirects=False,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            outcome = await run_flow(
                base_url=dial_base_url(api.base_url, self.local_target_host),
                headers=[Header.model_validate(h) for h in api.headers],
                secrets=secrets,
                steps=domain.steps,
                inputs=resolved,
                client=client,
            )
        record = FlowRunRecord(
            id=uuid.uuid4(),
            flow_id=flow.id,
            status=outcome.status,
            inputs=[asdict(item) for item in outcome.inputs],
            steps=[_step_json(asdict(step)) for step in outcome.steps],
            duration_ms=outcome.duration_ms,
            created_by=created_by,
        )
        db.add(record)
        await db.commit()
        return await get_run(db, record.id)


def _step_json(step: dict[str, Any]) -> dict[str, Any]:
    """Stored with camelCase keys, as the API returns them."""
    return {
        "index": step["index"],
        "title": step["title"],
        "status": step["status"],
        "request": step["request"],
        "response": step["response"],
        "durationMs": step["duration_ms"],
        "saved": step["saved"],
        "checks": step["checks"],
        "error": step["error"],
    }


async def get_run(db: AsyncSession, run_id: uuid.UUID) -> FlowRun:
    record = await db.get(FlowRunRecord, run_id, populate_existing=True)
    if record is None:
        raise FlowRunNotFound(str(run_id))
    return _run(record)


async def list_runs(db: AsyncSession, flow_id: uuid.UUID, *, limit: int) -> list[FlowRun]:
    """Newest first."""
    if await db.get(FlowRecord, flow_id) is None:
        raise FlowNotFound(str(flow_id))
    records = await db.scalars(
        select(FlowRunRecord)
        .where(FlowRunRecord.flow_id == flow_id)
        .order_by(FlowRunRecord.created_at.desc(), FlowRunRecord.id)
        .limit(min(limit, MAX_LISTED_RUNS))
    )
    return [_run(record) for record in records]


@dataclass(frozen=True)
class FlowRunSummary:
    id: uuid.UUID
    flow_id: uuid.UUID
    flow_name: str
    api_id: uuid.UUID
    api_name: str
    status: str
    step_count: int
    duration_ms: int
    created_at: datetime


async def list_all_runs(
    db: AsyncSession,
    *,
    status: str | None,
    api_id: uuid.UUID | None,
    flow_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> tuple[list[FlowRunSummary], int]:
    """Runs of every flow, newest first, without their steps' bodies."""
    filters = []
    if status is not None:
        filters.append(FlowRunRecord.status == status)
    if flow_id is not None:
        filters.append(FlowRunRecord.flow_id == flow_id)
    if api_id is not None:
        filters.append(FlowRecord.api_id == api_id)
    base = (
        select(
            FlowRunRecord.id,
            FlowRunRecord.flow_id,
            FlowRecord.name,
            ApiRecord.id,
            ApiRecord.name,
            FlowRunRecord.status,
            func.jsonb_array_length(FlowRunRecord.steps),
            FlowRunRecord.duration_ms,
            FlowRunRecord.created_at,
        )
        .join(FlowRecord, FlowRecord.id == FlowRunRecord.flow_id)
        .join(ApiRecord, ApiRecord.id == FlowRecord.api_id)
        .where(*filters)
    )
    total = await db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = await db.execute(
        base.order_by(FlowRunRecord.created_at.desc(), FlowRunRecord.id).limit(limit).offset(offset)
    )
    items = [FlowRunSummary(*row) for row in rows]
    return items, total


async def _secrets_for(
    db: AsyncSession, box: SecretBox, api_id: uuid.UUID, reveal: bool
) -> tuple[dict[str, str] | None, dict[str, str]]:
    api = await db.get(ApiRecord, api_id, populate_existing=True)
    hints = dict(api.secret_hints) if api else {}
    if not reveal or api is None:
        return None, hints
    return service.open_secrets(box, api), hints


async def run_curl(
    db: AsyncSession, box: SecretBox, run_id: uuid.UUID, step: int, *, reveal: bool
) -> str:
    """A step's request as sent in that run (secrets: hints, or the current values)."""
    record = await db.get(FlowRunRecord, run_id, populate_existing=True)
    if record is None:
        raise FlowRunNotFound(str(run_id))
    if not 0 <= step < len(record.steps) or record.steps[step]["request"] is None:
        raise StepNotFound(str(step))
    flow = await db.get(FlowRecord, record.flow_id)
    assert flow is not None  # runs are deleted with their flow
    secrets, hints = await _secrets_for(db, box, flow.api_id, reveal)
    return curl(record.steps[step]["request"], secrets, hints)


async def flow_curls(
    db: AsyncSession, box: SecretBox, flow_id: uuid.UUID, *, inputs: dict[str, Any], reveal: bool
) -> list[str]:
    """Every step's request before a run: inputs given (or defaults) filled in; values that only
    a run knows stay as placeholders."""
    domain = await service.get_flow(db, flow_id)
    flow = await db.get(FlowRecord, flow_id)
    assert flow is not None
    values = preview_inputs(domain.inputs, inputs)
    requests = preview_requests(
        base_url=flow.api.base_url,
        headers=[Header.model_validate(h) for h in flow.api.headers],
        steps=domain.steps,
        inputs=values,
    )
    secrets, hints = await _secrets_for(db, box, flow.api_id, reveal)
    return [curl(request, secrets, hints) for request in requests]


__all__ = ["FlowInputError", "FlowRunner"]
