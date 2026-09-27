"""Allowlisted document uploads. The original filename is metadata, never a path."""

import hashlib
import re
from pathlib import Path

from app.core.database import SessionLocal
from app.models.security_scan import FileSecurityScan
from app.core.exceptions import AppError

ALLOWED_TYPES: dict[str, frozenset[str]] = {
    ".pdf": frozenset({"application/pdf"}),
    ".docx": frozenset({"application/vnd.openxmlformats-officedocument.wordprocessingml.document"}),
    ".doc": frozenset({"application/msword"}),
    ".xlsx": frozenset({"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),
    ".xls": frozenset({"application/vnd.ms-excel"}),
    ".csv": frozenset({"text/csv", "application/csv", "text/plain"}),
    ".jpg": frozenset({"image/jpeg"}),
    ".jpeg": frozenset({"image/jpeg"}),
    ".png": frozenset({"image/png"}),
    ".txt": frozenset({"text/plain"}),
    ".md": frozenset({"text/markdown", "text/plain"}),
}

EVIDENCE_ALLOWED_TYPES: dict[str, frozenset[str]] = {
    **ALLOWED_TYPES,
    ".mp4": frozenset({"video/mp4"}),
    ".webm": frozenset({"video/webm"}),
    ".wav": frozenset({"audio/wav", "audio/x-wav", "audio/wave"}),
}

REJECTED_EXTENSIONS = frozenset({
    ".exe",
    ".bat",
    ".cmd",
    ".com",
    ".dll",
    ".js",
    ".mjs",
    ".sh",
    ".ps1",
    ".msi",
    ".scr",
    ".vbs",
    ".jar",
    ".html",
    ".htm",
    ".svg",
})

_NAME = re.compile(r"^[^\\/:*?\"<>|\r\n]{1,200}$")


def validate_evidence_upload(filename: str | None, content_type: str | None, content: bytes, max_bytes: int) -> tuple[str, str, str, str]:
    return _validate(filename, content_type, content, max_bytes, EVIDENCE_ALLOWED_TYPES)


def validate_upload(filename: str | None, content_type: str | None, content: bytes, max_bytes: int) -> tuple[str, str, str, str]:
    return _validate(filename, content_type, content, max_bytes, ALLOWED_TYPES)


def sha256_hex(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _demo_security_scan(content: bytes, file_hash: str) -> str:
    """Demo Security Scan for prototyping purposes."""
    lower_content = content.lower()
    status = "SAFE"
    message = None
    if b"malware_demo_block" in lower_content or b"eicar" in lower_content:
        status = "MALICIOUS"
        message = "File blocked by Demo Security Scan: Malicious content detected."
    elif b"suspicious_demo_flag" in lower_content or b"suspicious" in lower_content:
        status = "SUSPICIOUS"
        message = "Demo File Security Check: SUSPICIOUS content detected."
        
    with SessionLocal() as db:
        existing = db.query(FileSecurityScan).filter_by(file_hash=file_hash).first()
        if not existing:
            scan = FileSecurityScan(
                file_hash=file_hash,
                hash_algorithm="SHA-256",
                status=status,
                scanner_name="DemoScanner/1.0",
                message=message
            )
            db.add(scan)
            db.commit()
            
    return status


def _validate(
    filename: str | None,
    content_type: str | None,
    content: bytes,
    max_bytes: int,
    allowed: dict[str, frozenset[str]],
) -> tuple[str, str, str, str]:
    original = _safe_original_name(filename)
    extension = Path(original).suffix.lower()
    if extension in REJECTED_EXTENSIONS or extension not in allowed:
        raise AppError(422, "validation_error", "This file type is not allowed.")
    if len(content) == 0:
        raise AppError(422, "validation_error", "The file is empty.")
    if len(content) > max_bytes:
        raise AppError(413, "payload_too_large", "The file is larger than the configured maximum.")
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    if mime not in allowed[extension]:
        raise AppError(422, "validation_error", "The file content type is not allowed.")
    if _looks_executable(content):
        raise AppError(422, "validation_error", "This file type is not allowed.")
    if extension == ".pdf" and not content.startswith(b"%PDF"):
        raise AppError(422, "validation_error", "The file is not a valid PDF.")
    if extension == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise AppError(422, "validation_error", "The file is not a valid PNG.")
    if extension in {".jpg", ".jpeg"} and not content.startswith(b"\xff\xd8\xff"):
        raise AppError(422, "validation_error", "The file is not a valid JPEG.")
    if extension == ".mp4" and (len(content) < 12 or content[4:8] != b"ftyp"):
        raise AppError(422, "validation_error", "The file is not a valid MP4.")
    if extension == ".wav" and not (content.startswith(b"RIFF") and b"WAVE" in content[:16]):
        raise AppError(422, "validation_error", "The file is not a valid WAV.")
    if extension == ".webm" and not content.startswith(b"\x1a\x45\xdf\xa3"):
        raise AppError(422, "validation_error", "The file is not a valid WebM.")
    file_hash = sha256_hex(content)
    scan_result = _demo_security_scan(content, file_hash)
    if scan_result == "MALICIOUS":
        raise AppError(400, "security_blocked", "File blocked by Demo Security Scan: Malicious content detected.")
    
    return original, extension, mime, scan_result


def _safe_original_name(filename: str | None) -> str:
    raw = (filename or "").replace("\\", "/").strip()
    if not raw or raw != Path(raw).name or ".." in raw.split("/"):
        raise AppError(422, "validation_error", "The file name was rejected.")
    name = Path(raw).name
    if not _NAME.fullmatch(name):
        raise AppError(422, "validation_error", "The file name was rejected.")
    return name


def _looks_executable(content: bytes) -> bool:
    return content.startswith(b"MZ") or content.startswith(b"\x7fELF") or content.startswith(b"#!")
