from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.authorization.permission_service import effective_permission_codes
from app.core.database import get_db
from app.core.dependencies import require_authenticated_user
from app.core.exceptions import AppError
from app.models.user import User
from app.schemas.auth import LoginRequest, LogoutRequest, MeResponse, RefreshRequest, TokenResponse
from app.schemas.authorization import PermissionsResponse
from app.schemas.common import ErrorResponse
from app.services.audit_service import record
from app.services.auth_service import (
    authenticate_user,
    build_me,
    issue_token_pair,
    revoke_refresh_token,
    rotate_refresh_token,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

_AUTH_ERRORS = {
    401: {"model": ErrorResponse, "description": "Unauthorized"},
    422: {"model": ErrorResponse, "description": "Validation error"},
}


@router.post("/login", response_model=TokenResponse, responses=_AUTH_ERRORS)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = authenticate_user(db, payload.username, payload.password)
    if user is None:
        existing = db.scalar(select(User).where(User.username == payload.username))
        record(
            "LOGIN_FAILURE",
            user_id=existing.id if existing is not None else None,
            metadata={"username": payload.username},
        )
        raise AppError(401, "invalid_credentials", "Invalid username or password.")
    tokens = issue_token_pair(db, user)
    record("LOGIN_SUCCESS", user_id=user.id)
    return tokens


@router.post("/refresh", response_model=TokenResponse, responses=_AUTH_ERRORS)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)) -> TokenResponse:
    return rotate_refresh_token(db, payload.refresh_token)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    responses=_AUTH_ERRORS,
)
def logout(payload: LogoutRequest, db: Session = Depends(get_db)) -> None:
    revoke_refresh_token(db, payload.refresh_token)


@router.get(
    "/me",
    response_model=MeResponse,
    responses={
        **_AUTH_ERRORS,
        403: {"model": ErrorResponse, "description": "Forbidden"},
    },
)
def me(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_authenticated_user),
) -> MeResponse:
    return build_me(db, current_user)


@router.get(
    "/permissions",
    response_model=PermissionsResponse,
    responses={
        **_AUTH_ERRORS,
        403: {"model": ErrorResponse, "description": "Forbidden"},
    },
)
def permissions(current_user: User = Depends(require_authenticated_user)) -> PermissionsResponse:
    role_name = current_user.role.name if current_user.role is not None else ""
    return PermissionsResponse(role=role_name, permissions=effective_permission_codes(current_user))
