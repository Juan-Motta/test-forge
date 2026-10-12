"""Authentication dependencies: who is calling, and is the request allowed to act."""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Annotated, Literal

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.api_keys.service import resolve_api_key, touch_api_key
from voice_eval.modules.users.domain import User
from voice_eval.modules.users.sessions import ResolvedSession, resolve_session, touch_session
from voice_eval.platform.db import get_db_session
from voice_eval.platform.settings import Settings, app_settings

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@dataclass(frozen=True)
class Principal:
    """Who is calling: a session (cookie or Bearer token) or an API key (Bearer `ve_...`)."""

    user: User
    session_id: uuid.UUID | None  # None when authenticated with an API key
    via: Literal["cookie", "bearer", "api_key"]
    api_key_id: uuid.UUID | None = None


def origin_allowed(origin: str, settings: Settings) -> bool:
    return origin.rstrip("/") in settings.web_origins


def reject_foreign_origin(request: Request, settings: Settings) -> None:
    """CSRF baseline: a browser request whose Origin is not one of ours may not act."""
    origin = request.headers.get("origin")
    if origin is not None and not origin_allowed(origin, settings):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Origin not allowed")


async def authenticate(db: AsyncSession, token: str) -> ResolvedSession | None:
    """Resolve the session and, when due, record the activity (committed here, explicitly)."""
    resolved = await resolve_session(db, token)
    if resolved is not None and resolved.touch_due:
        await touch_session(db, resolved.session_id)
        await db.commit()
    return resolved


async def authenticate_bearer(db: AsyncSession, token: str) -> Principal | None:
    """Resolve a Bearer credential: a well-formed `ve_...` API key, else a session token.

    Like `authenticate`, records the use when due (committed here, explicitly).
    """
    resolved_key = await resolve_api_key(db, token)
    if resolved_key is not None:
        if resolved_key.touch_due:
            await touch_api_key(db, resolved_key.api_key_id)
            await db.commit()
        return Principal(resolved_key.user, None, via="api_key", api_key_id=resolved_key.api_key_id)
    resolved = await authenticate(db, token)
    return Principal(resolved.user, resolved.session_id, via="bearer") if resolved else None


def bearer_token(headers: Mapping[str, str]) -> str | None:
    scheme, _, credentials = headers.get("authorization", "").partition(" ")
    return (credentials.strip() or None) if scheme.lower() == "bearer" else None


async def current_principal(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(app_settings)],
) -> Principal:
    """Session cookie first, then `Authorization: Bearer` (API key or session token); 401
    otherwise, with the same body whatever was wrong.

    Cookie-authenticated unsafe requests must not come from a foreign Origin. Bearer requests
    skip that check: browsers never attach the header on their own.
    """
    cookie = request.cookies.get(settings.session_cookie_name)
    if cookie and (resolved := await authenticate(db, cookie)):
        if request.method in UNSAFE_METHODS:
            reject_foreign_origin(request, settings)
        return Principal(resolved.user, resolved.session_id, via="cookie")
    token = bearer_token(request.headers)
    if token and (principal := await authenticate_bearer(db, token)):
        return principal
    raise HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
