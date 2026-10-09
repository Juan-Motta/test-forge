"""HTTP API of the users module: `/api/auth/*`."""

import uuid
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy.ext.asyncio import AsyncSession

from voice_eval.modules.users import service
from voice_eval.modules.users.deps import Principal, current_principal, reject_foreign_origin
from voice_eval.modules.users.domain import InvalidCredentials, User
from voice_eval.modules.users.sessions import revoke_session
from voice_eval.platform.db import get_db_session
from voice_eval.platform.settings import Settings, app_settings

Db = Annotated[AsyncSession, Depends(get_db_session)]
AppSettings = Annotated[Settings, Depends(app_settings)]


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class UserOut(CamelModel):
    id: uuid.UUID
    email: str
    display_name: str

    @classmethod
    def of(cls, user: User) -> "UserOut":
        return cls(id=user.id, email=user.email, display_name=user.display_name)


class LoginRequest(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)


class LoginResponse(CamelModel):
    user: UserOut
    expires_at: datetime
    token: str | None = None  # only for `X-Client: cli`; browsers get the HttpOnly cookie


public_router = APIRouter(prefix="/auth", tags=["auth"])
protected_router = APIRouter(prefix="/auth", tags=["auth"])


@public_router.post("/login", response_model=LoginResponse, response_model_exclude_none=True)
async def login(
    body: LoginRequest, request: Request, response: Response, db: Db, settings: AppSettings
) -> LoginResponse:
    reject_foreign_origin(request, settings)
    ttl = timedelta(hours=settings.session_ttl_hours)
    try:
        issued = await service.login(
            db,
            body.email,
            body.password,
            ttl=ttl,
            user_agent=request.headers.get("user-agent"),
            ip=request.client.host if request.client else None,
        )
    except InvalidCredentials:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        ) from None
    response.set_cookie(
        settings.session_cookie_name,
        issued.token,
        max_age=int(ttl.total_seconds()),
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    is_cli = request.headers.get("x-client", "").strip().lower() == "cli"
    return LoginResponse(
        user=UserOut.of(issued.user),
        expires_at=issued.expires_at,
        token=issued.token if is_cli else None,
    )


@protected_router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    principal: Annotated[Principal, Depends(current_principal)], db: Db, settings: AppSettings
) -> Response:
    await revoke_session(db, principal.session_id)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite="lax",
    )
    return response


@protected_router.get("/me", response_model=UserOut)
async def me(principal: Annotated[Principal, Depends(current_principal)]) -> UserOut:
    return UserOut.of(principal.user)
