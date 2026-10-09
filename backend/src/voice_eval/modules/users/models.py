"""Persistence models for users, their sessions and login attempts."""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func, true
from sqlalchemy.orm import Mapped, mapped_column

from voice_eval.modules.users.domain import User
from voice_eval.platform.db import Base


class UserRecord(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email = lower(email)", name="email_lowercase"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    display_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def to_domain(self) -> User:
        return User(
            id=self.id,
            email=self.email,
            display_name=self.display_name,
            is_active=self.is_active,
            created_at=self.created_at,
            last_login_at=self.last_login_at,
        )


class SessionRecord(Base):
    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    user_agent: Mapped[str | None] = mapped_column(String(512))
    ip: Mapped[str | None] = mapped_column(String(45))


class LoginAttemptRecord(Base):
    """One verified login attempt, kept for a day to throttle password guessing."""

    __tablename__ = "login_attempts"
    __table_args__ = (
        Index("ix_login_attempts_email_created_at", "email", "created_at"),
        Index("ix_login_attempts_ip_created_at", "ip", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str | None] = mapped_column(String(320))  # canonical; NULL if input invalid
    ip: Mapped[str | None] = mapped_column(String(45))
    succeeded: Mapped[bool]
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
