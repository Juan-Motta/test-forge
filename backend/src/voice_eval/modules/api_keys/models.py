"""Persistence model for API keys: the hash of the key, never the key."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from voice_eval.modules.api_keys.domain import DISPLAY_PREFIX_LENGTH, MAX_NAME_LENGTH, ApiKey
from voice_eval.platform.db import Base


class ApiKeyRecord(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(MAX_NAME_LENGTH))
    prefix: Mapped[str] = mapped_column(String(DISPLAY_PREFIX_LENGTH), index=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    def to_domain(self) -> ApiKey:
        return ApiKey(
            id=self.id,
            user_id=self.user_id,
            name=self.name,
            prefix=self.prefix,
            created_at=self.created_at,
            last_used_at=self.last_used_at,
            expires_at=self.expires_at,
            revoked_at=self.revoked_at,
        )
