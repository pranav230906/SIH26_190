"""Login, refresh rotation, logout, and the current-user profile."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.exceptions import AppError, TokenError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    hash_token,
    verify_password,
    verify_password_for_missing_user,
)
from app.models.case_assignment import CaseAssignment
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.auth import DepartmentBrief, MeResponse, RoleBrief, TokenResponse


def authenticate_user(db: Session, username: str, password: str) -> User | None:
    user = db.scalar(
        select(User)
        .options(joinedload(User.role), joinedload(User.department))
        .where(User.username == username)
    )
    if user is None:
        verify_password_for_missing_user(password)
        return None
    if not verify_password(password, user.password_hash):
        return None
    if not user.is_active:
        return None
    return user


def issue_token_pair(db: Session, user: User) -> TokenResponse:
    access_token, expires_in = create_access_token(user.id)
    refresh_token, refresh_expires_at = create_refresh_token(user.id)
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(refresh_token),
            expires_at=refresh_expires_at,
        )
    )
    db.commit()
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
    )


def rotate_refresh_token(db: Session, raw_token: str) -> TokenResponse:
    try:
        payload = decode_refresh_token(raw_token)
    except TokenError as exc:
        raise AppError(401, "invalid_refresh_token", str(exc)) from exc

    record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token)))
    if record is None:
        raise AppError(401, "invalid_refresh_token", "Refresh token is not recognized.")

    now = datetime.now(timezone.utc)
    if record.revoked_at is not None:
        _revoke_active_tokens(db, record.user_id, now)
        db.commit()
        raise AppError(401, "invalid_refresh_token", "Refresh token is no longer valid.")

    expires_at = _as_utc(record.expires_at)
    if expires_at <= now:
        record.revoked_at = now
        db.commit()
        raise AppError(401, "invalid_refresh_token", "Refresh token has expired.")

    try:
        subject = uuid.UUID(str(payload.get("sub")))
    except (TypeError, ValueError) as exc:
        raise AppError(401, "invalid_refresh_token", "Invalid refresh token.") from exc

    if record.user_id != subject:
        raise AppError(401, "invalid_refresh_token", "Refresh token is not recognized.")

    user = db.scalar(
        select(User)
        .options(joinedload(User.role), joinedload(User.department))
        .where(User.id == record.user_id)
    )
    if user is None or not user.is_active:
        record.revoked_at = now
        db.commit()
        raise AppError(401, "invalid_refresh_token", "Refresh token is no longer valid.")

    record.revoked_at = now
    return issue_token_pair(db, user)


def revoke_refresh_token(db: Session, raw_token: str) -> None:
    try:
        decode_refresh_token(raw_token, verify_exp=False)
    except TokenError as exc:
        raise AppError(401, "invalid_refresh_token", "Invalid refresh token.") from exc

    record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token)))
    if record is None:
        raise AppError(401, "invalid_refresh_token", "Refresh token is not recognized.")

    if record.revoked_at is None:
        user_id = record.user_id
        record.revoked_at = datetime.now(timezone.utc)
        db.commit()
        from app.services.audit_service import record as audit_record

        audit_record("LOGOUT", user_id=user_id)


def build_me(db: Session, user: User) -> MeResponse:
    if user.role is None or user.department is None:
        raise AppError(403, "forbidden", "This account is missing a role or department.")

    assigned_case_ids = list(
        db.scalars(
            select(CaseAssignment.case_id)
            .where(
                CaseAssignment.user_id == user.id,
                CaseAssignment.active.is_(True),
            )
            .order_by(CaseAssignment.assigned_at.asc())
        ).all()
    )
    return MeResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=RoleBrief(name=user.role.name, description=user.role.description),
        department=DepartmentBrief(name=user.department.name, code=user.department.code),
        assigned_case_ids=assigned_case_ids,
    )


def _revoke_active_tokens(db: Session, user_id: uuid.UUID, now: datetime) -> None:
    tokens = db.scalars(
        select(RefreshToken).where(
            RefreshToken.user_id == user_id,
            RefreshToken.revoked_at.is_(None),
        )
    ).all()
    for token in tokens:
        token.revoked_at = now


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value
