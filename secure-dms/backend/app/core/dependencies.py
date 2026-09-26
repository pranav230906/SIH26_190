"""Reusable authentication dependencies. Routes must not reimplement token checks."""

import uuid

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

import app.models  # noqa: F401  # Register every mapper before the first query.
from app.core.database import get_db
from app.core.exceptions import AppError, TokenError
from app.core.security import decode_access_token
from app.models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise AppError(401, "unauthorized", "Authentication is required.")

    try:
        payload = decode_access_token(credentials.credentials)
    except TokenError as exc:
        code = "token_expired" if exc.expired else "invalid_token"
        raise AppError(401, code, str(exc)) from exc

    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (TypeError, ValueError) as exc:
        raise AppError(401, "invalid_token", "Invalid access token.") from exc

    user = db.scalar(
        select(User)
        .options(joinedload(User.role), joinedload(User.department))
        .where(User.id == user_id)
    )
    if user is None or not user.is_active:
        raise AppError(401, "authentication_failed", "Authentication failed.")
    return user


def require_authenticated_user(user: User = Depends(get_current_user)) -> User:
    if not user.is_active:
        raise AppError(401, "authentication_failed", "Authentication failed.")
    return user
