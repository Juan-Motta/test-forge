"""Persistence model for evaluation scenarios. Structured parts are JSON (snake_case keys)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from voice_eval.modules.agents.models import AgentRecord
from voice_eval.modules.connections.domain import DEFAULT_REALTIME_MODEL, RealtimeModel
from voice_eval.modules.scenarios.domain import (
    MAX_NAME_LENGTH,
    MAX_TAG_LENGTH,
    AgentSummary,
    Criterion,
    EndConditions,
    EvaluatorMode,
    Fact,
    GroupSummary,
    Interruption,
    Persona,
    Scenario,
)
from voice_eval.platform.db import Base

NAME_UNIQUE_CONSTRAINT = "uq_scenarios_agent_id_name"
GROUP_NAME_UNIQUE_CONSTRAINT = "uq_scenario_groups_name"


class ScenarioGroupRecord(Base):
    __tablename__ = "scenario_groups"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        UniqueConstraint("name", name=GROUP_NAME_UNIQUE_CONSTRAINT),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(MAX_NAME_LENGTH))
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    tags: Mapped[list[str]] = mapped_column(
        ARRAY(String(MAX_TAG_LENGTH)), default=list, server_default=text("'{}'::varchar[]")
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ScenarioRecord(Base):
    __tablename__ = "scenarios"
    __table_args__ = (
        CheckConstraint("length(btrim(name)) > 0", name="name_not_blank"),
        CheckConstraint("length(btrim(goal)) > 0", name="goal_not_blank"),
        UniqueConstraint("agent_id", "name", name=NAME_UNIQUE_CONSTRAINT),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="RESTRICT"))
    group_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("scenario_groups.id", ondelete="RESTRICT"), index=True
    )
    name: Mapped[str] = mapped_column(String(MAX_NAME_LENGTH))
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(MAX_TAG_LENGTH)))
    context: Mapped[str] = mapped_column(Text)
    persona: Mapped[dict[str, Any]] = mapped_column(JSONB)
    tts_connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("provider_connections.id", ondelete="SET NULL")
    )
    evaluator_connection_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("provider_connections.id", ondelete="SET NULL")
    )
    voice_override: Mapped[str | None] = mapped_column(String(100))
    goal: Mapped[str] = mapped_column(Text)
    instructions: Mapped[str] = mapped_column(Text)
    facts: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    criteria: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    end_conditions: Mapped[dict[str, Any]] = mapped_column(JSONB)
    interruptions: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    evaluator_mode: Mapped[str] = mapped_column(
        String(20),
        default=EvaluatorMode.PIPELINE.value,
        server_default=EvaluatorMode.PIPELINE.value,
    )
    realtime_model: Mapped[str] = mapped_column(
        String(40),
        default=DEFAULT_REALTIME_MODEL.value,
        server_default=DEFAULT_REALTIME_MODEL.value,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    agent: Mapped[AgentRecord] = relationship(lazy="joined", innerjoin=True)
    group: Mapped[ScenarioGroupRecord] = relationship(lazy="joined", innerjoin=True)

    def to_domain(self) -> Scenario:
        return Scenario(
            id=self.id,
            agent=AgentSummary(id=self.agent.id, name=self.agent.name),
            name=self.name,
            tags=list(self.tags),
            context=self.context,
            persona=Persona.model_validate(self.persona),
            tts_connection_id=self.tts_connection_id,
            evaluator_connection_id=self.evaluator_connection_id,
            voice_override=self.voice_override,
            goal=self.goal,
            instructions=self.instructions,
            facts=[Fact.model_validate(fact) for fact in self.facts],
            criteria=[Criterion.model_validate(criterion) for criterion in self.criteria],
            end_conditions=EndConditions.model_validate(self.end_conditions),
            created_at=self.created_at,
            updated_at=self.updated_at,
            interruptions=[Interruption.model_validate(item) for item in self.interruptions],
            evaluator_mode=EvaluatorMode(self.evaluator_mode),
            realtime_model=RealtimeModel(self.realtime_model),
            group=GroupSummary(id=self.group.id, name=self.group.name),
        )
