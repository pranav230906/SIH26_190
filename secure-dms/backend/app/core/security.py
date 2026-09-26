"""Password hashing and JWT creation. Tokens are signed with environment secrets."""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from jwt import ExpiredSignatureError, InvalidTokenError

from app.core.config import get_settings
from app.core.exceptions import TokenError

_password_hasher = PasswordHasher()
# Used when the username does not exist so login timing stays comparable.
_DUMMY_PASSWORD_HASH = _password_hasher.hash("dummy-password-not-a-credential")

_ALGORITHM = "HS256"
_ISSUER = "secure-dms"


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def verify_password_for_missing_user(password: str) -> None:
    verify_password(password, _DUMMY_PASSWORD_HASH)


def hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_access_token(user_id: uuid.UUID) -> tuple[str, int]:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires_in = settings.access_token_expire_minutes * 60
    payload = {
        "iss": _ISSUER,
        "sub": str(user_id),
        "type": "access",
        "jti": str(uuid.uuid4()),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret_key, algorithm=_ALGORITHM)
    return token, expires_in


def create_refresh_token(user_id: uuid.UUID) -> tuple[str, datetime]:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=settings.refresh_token_expire_days)
    payload = {
        "iss": _ISSUER,
        "sub": str(user_id),
        "type": "refresh",
        "jti": str(uuid.uuid4()),
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_refresh_secret_key, algorithm=_ALGORITHM)
    return token, expires_at


def decode_access_token(token: str) -> dict:
    settings = get_settings()
    return _decode(token, settings.jwt_secret_key, expected_type="access")


def decode_refresh_token(token: str, *, verify_exp: bool = True) -> dict:
    settings = get_settings()
    return _decode(
        token,
        settings.jwt_refresh_secret_key,
        expected_type="refresh",
        verify_exp=verify_exp,
    )


def _decode(
    token: str,
    secret: str,
    *,
    expected_type: str,
    verify_exp: bool = True,
) -> dict:
    try:
        payload = jwt.decode(
            token,
            secret,
            algorithms=[_ALGORITHM],
            issuer=_ISSUER,
            options={
                "require": ["exp", "iat", "sub", "type", "iss", "jti"],
                "verify_exp": verify_exp,
            },
        )
    except ExpiredSignatureError as exc:
        raise TokenError("Access token has expired." if expected_type == "access" else "Refresh token has expired.", expired=True) from exc
    except InvalidTokenError as exc:
        raise TokenError(
            "Invalid access token." if expected_type == "access" else "Invalid refresh token."
        ) from exc

    if payload.get("type") != expected_type:
        raise TokenError(
            "Invalid access token." if expected_type == "access" else "Invalid refresh token."
        )
    return payload
