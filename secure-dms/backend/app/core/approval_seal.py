"""Application HMAC seal. This is not a public-key certificate."""

import hashlib
import hmac
from datetime import datetime

from app.core.config import get_settings


def approval_seal(subject_hash: str, signer_id: str, stamped: datetime) -> tuple[str, str | None]:
    secret = get_settings().approval_signing_key.strip()
    if not secret:
        return "UNCONFIGURED", None
    message = f"{subject_hash}|{signer_id}|{stamped.isoformat()}".encode("utf-8")
    value = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return "HMAC-SHA256", value
