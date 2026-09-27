"""AES-GCM storage for new evidence. The recorded SHA-256 is always the original bytes."""

import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import get_settings
from app.core.exceptions import AppError

MAGIC = b"SDMS1"
_NONCE_LEN = 12


def protect_new_bytes(content: bytes) -> tuple[bytes, bool]:
    secret = get_settings().storage_master_key.strip()
    if not secret:
        raise AppError(
            503,
            "service_unavailable",
            "Evidence storage is not configured. Set STORAGE_MASTER_KEY before uploading evidence.",
        )
    return encrypt_content(content, secret), True


def read_plaintext(blob: bytes, encrypted: bool) -> bytes:
    if not encrypted:
        return blob
    secret = get_settings().storage_master_key.strip()
    if not secret:
        raise AppError(
            503,
            "service_unavailable",
            "Evidence storage is not configured. Set STORAGE_MASTER_KEY before reading encrypted evidence.",
        )
    return decrypt_content(blob, secret)


def encrypt_content(content: bytes, secret: str) -> bytes:
    key = hashlib.sha256(secret.encode("utf-8")).digest()
    nonce = os.urandom(_NONCE_LEN)
    return MAGIC + nonce + AESGCM(key).encrypt(nonce, content, None)


def decrypt_content(blob: bytes, secret: str) -> bytes:
    if not blob.startswith(MAGIC) or len(blob) < len(MAGIC) + _NONCE_LEN + 16:
        raise AppError(409, "conflict", "The stored evidence file could not be decrypted.")
    key = hashlib.sha256(secret.encode("utf-8")).digest()
    nonce = blob[len(MAGIC) : len(MAGIC) + _NONCE_LEN]
    try:
        return AESGCM(key).decrypt(nonce, blob[len(MAGIC) + _NONCE_LEN :], None)
    except Exception as exc:
        raise AppError(409, "conflict", "The stored evidence file could not be decrypted.") from exc
