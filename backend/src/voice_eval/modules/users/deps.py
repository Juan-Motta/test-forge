"""Authentication dependencies: who is calling, and is the request allowed to act."""

import uuid
from dataclasses import dataclass
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.users.domain import User
from voice_eval.modules.users.sessions import ResolvedSession, resolve_session, touch_session
from voice_eval.platform.db import get_db_session
from voice_eval.platform.settings import Settings, app_settings

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@dataclass(frozen=True)
class Principal:
    user: User
    session_id: uuid.UUID
    via: Literal["cookie", "bearer"]


def reject_foreign_origin(request: Request, settings: Settings) -> None:
    """CSRF baseline: a browser request whose Origin is not one of ours may not act."""
    origin = request.headers.get("origin")
    if origin is not None and origin.rstrip("/") not in settings.web_origins:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Origin not allowed")


async def _authenticate(db: AsyncSession, token: str) -> ResolvedSession | None:
    """Resolve the session and, when due, record the activity (committed here, explicitly)."""
    resolved = await resolve_session(db, token)
    if resolved is not None and resolved.touch_due:
        await touch_session(db, resolved.session_id)
        await db.commit()
    return resolved


def _bearer_token(request: Request) -> str | None:
    scheme, _, credentials = request.headers.get("authorization", "").partition(" ")
    return (credentials.strip() or None) if scheme.lower() == "bearer" else None


async def current_principal(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(app_settings)],
) -> Principal:
    """Session cookie first, then `Authorization: Bearer`; 401 otherwise.

    Cookie-authenticated unsafe requests must not come from a foreign Origin. Bearer requests
    skip that check: browsers never attach the header on their own.
    """
    cookie = request.cookies.get(settings.session_cookie_name)
    if cookie and (resolved := await _authenticate(db, cookie)):
        if request.method in UNSAFE_METHODS:
            reject_foreign_origin(request, settings)
        return Principal(resolved.user, resolved.session_id, via="cookie")
    token = _bearer_token(request)
    if token and (resolved := await _authenticate(db, token)):
        return Principal(resolved.user, resolved.session_id, via="bearer")
    raise HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
