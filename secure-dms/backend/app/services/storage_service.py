"""Local case-oriented file storage. Callers never build paths from user filenames."""

import re
import uuid
from pathlib import Path

from app.core.config import get_settings
from app.core.exceptions import AppError

_CASE_NUMBER = re.compile(r"^CASE-\d{4}-\d{3,}$")


class StorageService:
    def __init__(self, root: Path | None = None) -> None:
        self.root = (root or get_settings().storage_path).resolve()

    def save_case_document(self, case_number: str, extension: str, content: bytes) -> tuple[str, str]:
        return self._save(case_number, ("documents",), extension, content, _DOCUMENT_SUFFIXES)

    def save_document_version(
        self,
        case_number: str,
        document_number: str,
        version_number: int,
        extension: str,
        content: bytes,
    ) -> tuple[str, str]:
        if version_number < 1:
            raise AppError(422, "validation_error", "The version number was rejected.")
        safe_document = _require_document_number(document_number)
        return self._save(
            case_number,
            ("documents", safe_document, "versions", f"v{version_number}"),
            extension,
            content,
            _DOCUMENT_SUFFIXES,
        )

    def save_original_evidence(self, case_number: str, extension: str, content: bytes) -> tuple[str, str]:
        return self._save(case_number, ("evidence", "originals"), extension, content, _EVIDENCE_SUFFIXES)

    def save_derived_artifact(self, case_number: str, extension: str, content: bytes) -> tuple[str, str]:
        return self._save(case_number, ("evidence", "derived"), extension, content, _EVIDENCE_SUFFIXES)

    def _save(
        self,
        case_number: str,
        folders: tuple[str, ...],
        extension: str,
        content: bytes,
        allowed: set[str],
    ) -> tuple[str, str]:
        safe_case = _require_case_number(case_number)
        suffix = extension if extension.startswith(".") else f".{extension}"
        suffix = suffix.lower()
        if suffix not in allowed or "/" in suffix or "\\" in suffix:
            raise AppError(422, "validation_error", "This file type is not allowed.")
        stored_name = f"{uuid.uuid4()}{suffix}"
        relative = Path("cases") / safe_case
        for folder in folders:
            relative = relative / folder
        relative = relative / stored_name
        target = self._resolve(relative.as_posix())
        if target.exists():
            raise AppError(409, "conflict", "A stored file with this name already exists.")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        return stored_name, relative.as_posix()

    def get_file(self, relative_path: str) -> Path:
        path = self._resolve(relative_path)
        if not path.is_file():
            raise AppError(404, "not_found", "The stored file is not available.")
        return path

    def delete_file(self, relative_path: str) -> None:
        path = self._resolve(relative_path)
        if path.is_file():
            path.unlink()

    def file_exists(self, relative_path: str) -> bool:
        try:
            return self._resolve(relative_path).is_file()
        except AppError:
            return False

    def _resolve(self, relative_path: str) -> Path:
        if not relative_path or relative_path.startswith(("/", "\\")):
            raise AppError(422, "validation_error", "The file path was rejected.")
        parts = Path(relative_path).parts
        if any(part in {"", ".", ".."} for part in parts):
            raise AppError(422, "validation_error", "The file path was rejected.")
        candidate = (self.root / relative_path).resolve()
        root = self.root.resolve()
        if candidate != root and root not in candidate.parents:
            raise AppError(422, "validation_error", "The file path was rejected.")
        return candidate


_DOCUMENT_SUFFIXES = {
    ".pdf",
    ".docx",
    ".doc",
    ".xlsx",
    ".xls",
    ".csv",
    ".jpg",
    ".jpeg",
    ".png",
    ".txt",
    ".md",
}

_EVIDENCE_SUFFIXES = _DOCUMENT_SUFFIXES | {".mp4", ".webm", ".wav"}


def _require_case_number(value: str) -> str:
    if not _CASE_NUMBER.fullmatch(value or ""):
        raise AppError(422, "validation_error", "The case folder name was rejected.")
    return value


_DOCUMENT_NUMBER = re.compile(r"^DOC-\d{4}-\d{6}$")


def _require_document_number(value: str) -> str:
    if not _DOCUMENT_NUMBER.fullmatch(value or ""):
        raise AppError(422, "validation_error", "The document folder name was rejected.")
    return value


def get_storage() -> StorageService:
    return StorageService()
