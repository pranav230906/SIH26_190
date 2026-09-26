"""Controlled document revisions. Each version is a complete file. The official file is replaced only after approval."""

import uuid
from datetime import datetime, timezone

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.authorization.permission_service import authorize, enforce
from app.authorization.policies import DOCUMENT_VERSION_TRANSITIONS
from app.constants import (
    Action,
    CaseEventType,
    DocumentStatus,
    DocumentVersionStatus,
    IntegrityStatus,
    ResourceType,
    VersionReviewDecision,
)
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.user import User
from app.schemas.revision import VersionDetail, VersionDiff, VersionIntegrity, VersionSummary
from app.services.case_timeline import add_event
from app.services.document_service import _read_limited, _require_visible
from app.services.revision_diff import UNSUPPORTED, compare_texts, extract_text
from app.services.storage_service import get_storage
from app.services.upload_validation import sha256_hex, validate_upload

HASH_ALGORITHM = "SHA-256"
INTEGRITY_BLOCKED = "Document integrity verification failed."
INDEPENDENT_APPROVAL = "Independent approval is required."
_LOCKED = {DocumentStatus.SEALED.value, DocumentStatus.ARCHIVED.value}


def list_versions(db: Session, user: User, document_id: uuid.UUID) -> tuple[list[VersionSummary], int | None]:
    document = _document(db, user, document_id)
    enforce(authorize(user, Action.READ, ResourceType.REVISION, case=document.case))
    rows = _versions(db, document.id)
    official = next((row.version_number for row in rows if row.is_official), None)
    return [_summary(user, row) for row in rows], official


def official_version(db: Session, user: User, document_id: uuid.UUID) -> VersionDetail:
    document = _document(db, user, document_id)
    enforce(authorize(user, Action.READ, ResourceType.REVISION, case=document.case))
    version = _official(db, document.id)
    if version is None:
        raise AppError(404, "not_found", "No official version is available.")
    return _detail(user, version)


def get_version(db: Session, user: User, version_id: uuid.UUID) -> VersionDetail:
    version = _require(db, user, version_id)
    add_event(
        db,
        case_id=version.document.case_id,
        event_type=CaseEventType.DOCUMENT_VERSION_VIEWED,
        message=f"{version.version_label} of {version.document.document_number} viewed.",
        actor_id=user.id,
    )
    db.commit()
    stored = _load(db, version.id)
    if stored is None:
        raise AppError(404, "not_found", "Document version not found.")
    return _detail(user, stored)


def create_revision(db: Session, user: User, document_id: uuid.UUID, upload: UploadFile, change_summary: str) -> VersionDetail:
    document = _document(db, user, document_id)
    if document.status in _LOCKED:
        raise AppError(403, "forbidden", "You are not authorized to perform this action.")
    enforce(authorize(user, Action.CREATE, ResourceType.REVISION, case=document.case))
    official = _official(db, document.id)
    if official is None:
        raise AppError(422, "validation_error", "An official version is required before a new revision can be created.")
    summary = change_summary.strip()
    if len(summary) < 10:
        raise AppError(422, "validation_error", "Describe what changed in this revision.")
    content = _read_limited(upload)
    original_name, extension, mime = validate_upload(
        upload.filename,
        upload.content_type,
        content,
        get_settings().max_upload_size_mb * 1024 * 1024,
    )
    number = _next_number(db, document.id)
    _assert_no_cycle(db, official.id)
    digest = sha256_hex(content)
    stored_name, relative = get_storage().save_document_version(
        document.case.case_number,
        document.document_number,
        number,
        extension,
        content,
    )
    version = DocumentVersion(
        document_id=document.id,
        version_number=number,
        version_label=f"v{number}",
        storage_path=relative,
        original_filename=original_name,
        stored_filename=stored_name,
        mime_type=mime,
        file_size=len(content),
        sha256_hash=digest,
        hash_algorithm=HASH_ALGORITHM,
        created_by=user.id,
        status=DocumentVersionStatus.DRAFT.value,
        change_summary=summary,
        parent_version_id=official.id,
        is_official=False,
    )
    db.add(version)
    try:
        db.flush()
        add_event(
            db,
            case_id=document.case_id,
            event_type=CaseEventType.DOCUMENT_REVISION_CREATED,
            message=f"{version.version_label} of {document.document_number} created as a draft.",
            actor_id=user.id,
        )
        db.commit()
    except Exception:
        db.rollback()
        get_storage().delete_file(relative)
        raise
    stored = _load(db, version.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    _audit(
        "DOCUMENT_REVISION_CREATED",
        user_id=user.id,
        case_id=document.case_id,
        document_id=document.id,
        version_id=stored.id,
        metadata={"version_label": stored.version_label},
    )
    _index_after_revision(db, stored.document)
    return _detail(user, stored)


def attach_initial_version(db: Session, document: Document, user: User) -> None:
    """Record version 1 for a newly uploaded document without copying the file."""
    version = DocumentVersion(
        document_id=document.id,
        version_number=1,
        version_label="v1",
        storage_path=document.storage_path,
        original_filename=document.original_filename,
        stored_filename=document.stored_filename,
        mime_type=document.mime_type,
        file_size=document.file_size,
        sha256_hash=document.file_hash,
        hash_algorithm=document.hash_algorithm,
        created_by=user.id,
        status=DocumentVersionStatus.DRAFT.value,
        change_summary="Initial version.",
        parent_version_id=None,
        is_official=False,
    )
    db.add(version)
    db.flush()
    add_event(
        db,
        case_id=document.case_id,
        event_type=CaseEventType.DOCUMENT_REVISION_CREATED,
        message=f"v1 of {document.document_number} created as a draft.",
        actor_id=user.id,
    )


def version_diff(db: Session, user: User, version_id: uuid.UUID) -> VersionDiff:
    version = _require(db, user, version_id)
    if version.parent_version_id is None or version.parent is None:
        return VersionDiff(
            parent_version=None,
            current_version=version.version_number,
            comparable=False,
            message="This version has no parent to compare.",
            changes=[],
        )
    parent_text = _text(version.parent)
    current_text = _text(version)
    if parent_text is None or current_text is None:
        return VersionDiff(
            parent_version=version.parent.version_number,
            current_version=version.version_number,
            comparable=False,
            message=UNSUPPORTED,
            changes=[],
        )
    return VersionDiff(
        parent_version=version.parent.version_number,
        current_version=version.version_number,
        comparable=True,
        message=None,
        changes=compare_texts(parent_text, current_text),
    )


def version_integrity(db: Session, user: User, version_id: uuid.UUID) -> VersionIntegrity:
    version = _require(db, user, version_id)
    return _integrity(version)


def submit_version(db: Session, user: User, version_id: uuid.UUID) -> VersionDetail:
    version = _require(db, user, version_id, lock=True)
    _ensure(version, DocumentVersionStatus.SUBMITTED_FOR_REVIEW)
    enforce(authorize(user, Action.UPDATE, ResourceType.REVISION, resource=version, case=version.document.case))
    if version.version_number > 1 and version.parent_version_id is None:
        raise AppError(422, "validation_error", "A revision must reference its parent version.")
    _assert_parent(db, version)
    if _integrity(version).integrity_status != IntegrityStatus.VERIFIED.value:
        raise AppError(409, "conflict", INTEGRITY_BLOCKED)
    now = datetime.now(timezone.utc)
    version.status = DocumentVersionStatus.SUBMITTED_FOR_REVIEW.value
    version.submitted_by = user.id
    version.submitted_at = now
    add_event(
        db,
        case_id=version.document.case_id,
        event_type=CaseEventType.DOCUMENT_REVISION_SUBMITTED,
        message=f"{version.version_label} of {version.document.document_number} submitted for review.",
        actor_id=user.id,
    )
    db.commit()
    stored = _load(db, version.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    _audit(
        "DOCUMENT_REVISION_SUBMITTED",
        user_id=user.id,
        case_id=stored.document.case_id,
        document_id=stored.document_id,
        version_id=stored.id,
        metadata={"version_label": stored.version_label},
    )
    _index_after_revision(db, stored.document)
    return _detail(user, stored)


def review_version(db: Session, user: User, version_id: uuid.UUID, decision: VersionReviewDecision, comment: str | None) -> VersionDetail:
    version = _require(db, user, version_id, lock=True)
    if decision == VersionReviewDecision.APPROVE and version.created_by == user.id:
        _audit(
            "UNAUTHORIZED_ACCESS_ATTEMPT",
            user_id=user.id,
            case_id=version.document.case_id,
            document_id=version.document_id,
            version_id=version.id,
            metadata={"action": "APPROVE"},
        )
        raise AppError(403, "forbidden", INDEPENDENT_APPROVAL)
    note = comment.strip() if comment else ""
    if decision == VersionReviewDecision.REJECT and len(note) < 10:
        raise AppError(422, "validation_error", "A review comment is required when rejecting a revision.")
    target = DocumentVersionStatus.APPROVED if decision == VersionReviewDecision.APPROVE else DocumentVersionStatus.REJECTED
    _ensure(version, target)
    action = Action.APPROVE if decision == VersionReviewDecision.APPROVE else Action.REJECT
    enforce(authorize(user, action, ResourceType.REVISION, resource=version, case=version.document.case))
    _assert_parent(db, version)
    if _integrity(version).integrity_status != IntegrityStatus.VERIFIED.value:
        raise AppError(409, "conflict", INTEGRITY_BLOCKED)
    now = datetime.now(timezone.utc)
    if decision == VersionReviewDecision.APPROVE:
        _promote(db, version, user, now)
        event_type = CaseEventType.DOCUMENT_REVISION_APPROVED
        message = f"{version.version_label} of {version.document.document_number} approved as the official version."
    else:
        version.status = DocumentVersionStatus.REJECTED.value
        version.review_comment = note
        version.rejected_by = user.id
        version.rejected_at = now
        event_type = CaseEventType.DOCUMENT_REVISION_REJECTED
        message = f"{version.version_label} of {version.document.document_number} rejected."
    add_event(db, case_id=version.document.case_id, event_type=event_type, message=message, actor_id=user.id)
    db.commit()
    stored = _load(db, version.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    _audit(
        "DOCUMENT_REVISION_APPROVED" if decision == VersionReviewDecision.APPROVE else "DOCUMENT_REVISION_REJECTED",
        user_id=user.id,
        case_id=stored.document.case_id,
        document_id=stored.document_id,
        version_id=stored.id,
        metadata={"version_label": stored.version_label},
    )
    _index_after_revision(db, stored.document)
    return _detail(user, stored)


def open_version_download(db: Session, user: User, version_id: uuid.UUID) -> tuple[DocumentVersion, str]:
    version = _require(db, user, version_id)
    enforce(authorize(user, Action.DOWNLOAD, ResourceType.DOCUMENT, resource=version.document, case=version.document.case))
    path = get_storage().get_file(version.storage_path)
    add_event(
        db,
        case_id=version.document.case_id,
        event_type=CaseEventType.DOCUMENT_VERSION_DOWNLOADED,
        message=f"{version.version_label} of {version.document.document_number} downloaded.",
        actor_id=user.id,
    )
    db.commit()
    _audit(
        "DOCUMENT_VERSION_DOWNLOADED",
        user_id=user.id,
        case_id=version.document.case_id,
        document_id=version.document_id,
        version_id=version.id,
        metadata={"version_label": version.version_label},
    )
    return version, str(path)


def official_download_path(db: Session, user: User, document: Document, *, record_download: bool) -> tuple[DocumentVersion, str]:
    enforce(authorize(user, Action.READ, ResourceType.REVISION, case=document.case))
    version = _official(db, document.id)
    if version is None:
        raise AppError(409, "conflict", "No official version is available.")
    path = get_storage().get_file(version.storage_path)
    if record_download:
        add_event(
            db,
            case_id=document.case_id,
            event_type=CaseEventType.DOCUMENT_VERSION_DOWNLOADED,
            message=f"Official {version.version_label} of {document.document_number} downloaded.",
            actor_id=user.id,
        )
        db.commit()
    return version, str(path)


def _audit(event_type: str, **fields) -> None:
    from app.services.audit_service import record

    record(event_type, **fields)


def _promote(db: Session, version: DocumentVersion, user: User, now: datetime) -> None:
    current = db.scalar(
        select(DocumentVersion)
        .where(DocumentVersion.document_id == version.document_id, DocumentVersion.is_official.is_(True))
        .with_for_update()
    )
    if current is not None and current.id != version.id:
        _ensure(current, DocumentVersionStatus.SUPERSEDED)
        current.is_official = False
        current.status = DocumentVersionStatus.SUPERSEDED.value
        db.flush()
    version.status = DocumentVersionStatus.APPROVED.value
    version.is_official = True
    version.approved_by = user.id
    version.approved_at = now
    version.review_comment = None
    document = version.document
    document.storage_path = version.storage_path
    document.stored_filename = version.stored_filename
    document.original_filename = version.original_filename
    document.mime_type = version.mime_type
    document.file_size = version.file_size
    document.file_hash = version.sha256_hash
    document.hash_algorithm = version.hash_algorithm
    document.updated_at = now


def _integrity(version: DocumentVersion) -> VersionIntegrity:
    path = get_storage().get_file(version.storage_path)
    current = sha256_hex(path.read_bytes())
    status = IntegrityStatus.VERIFIED.value if current == version.sha256_hash else IntegrityStatus.INTEGRITY_MISMATCH.value
    return VersionIntegrity(
        version_id=version.id,
        algorithm=version.hash_algorithm,
        stored_hash=version.sha256_hash,
        current_hash=current,
        integrity_status=status,
    )


def _text(version: DocumentVersion) -> str | None:
    content = get_storage().get_file(version.storage_path).read_bytes()
    excerpt = extract_text(version.original_filename, version.mime_type, content)
    if excerpt is None:
        return None
    return excerpt


def _assert_parent(db: Session, version: DocumentVersion) -> None:
    if version.parent_version_id is None:
        return
    parent = db.get(DocumentVersion, version.parent_version_id)
    if parent is None or parent.document_id != version.document_id or parent.id == version.id:
        raise AppError(422, "validation_error", "The parent version does not belong to this document.")
    _assert_no_cycle(db, version.id)


def _assert_no_cycle(db: Session, start_id: uuid.UUID) -> None:
    seen: set[uuid.UUID] = set()
    current: uuid.UUID | None = start_id
    while current is not None:
        if current in seen:
            raise AppError(422, "validation_error", "This version link would create a cycle.")
        seen.add(current)
        current = db.scalar(select(DocumentVersion.parent_version_id).where(DocumentVersion.id == current))


def _ensure(version: DocumentVersion, target: DocumentVersionStatus) -> None:
    allowed = DOCUMENT_VERSION_TRANSITIONS.get(version.status, frozenset())
    if target.value not in allowed:
        raise AppError(422, "validation_error", "That status change is not allowed.")


def _next_number(db: Session, document_id: uuid.UUID) -> int:
    current = db.scalars(select(DocumentVersion.version_number).where(DocumentVersion.document_id == document_id)).all()
    return (max(current) if current else 0) + 1


def _official(db: Session, document_id: uuid.UUID) -> DocumentVersion | None:
    return db.scalar(
        select(DocumentVersion)
        .options(joinedload(DocumentVersion.creator), joinedload(DocumentVersion.approver), joinedload(DocumentVersion.parent))
        .where(DocumentVersion.document_id == document_id, DocumentVersion.is_official.is_(True))
    )


def _versions(db: Session, document_id: uuid.UUID) -> list[DocumentVersion]:
    return db.scalars(
        select(DocumentVersion)
        .options(
            joinedload(DocumentVersion.document).joinedload(Document.case),
            joinedload(DocumentVersion.creator),
            joinedload(DocumentVersion.approver),
            joinedload(DocumentVersion.parent),
        )
        .where(DocumentVersion.document_id == document_id)
        .order_by(DocumentVersion.version_number.asc())
    ).unique().all()


def _document(db: Session, user: User, document_id: uuid.UUID) -> Document:
    document = db.scalar(
        select(Document).options(joinedload(Document.case), joinedload(Document.creator)).where(Document.id == document_id)
    )
    if document is None or document.case is None:
        raise AppError(404, "not_found", "Document not found.")
    _require_visible(user, document)
    return document


def _require(db: Session, user: User, version_id: uuid.UUID, *, lock: bool = False) -> DocumentVersion:
    if lock:
        locked = db.scalar(select(DocumentVersion).where(DocumentVersion.id == version_id).with_for_update())
        if locked is None:
            raise AppError(404, "not_found", "Document version not found.")
    version = db.scalar(
        select(DocumentVersion)
        .options(
            joinedload(DocumentVersion.document).joinedload(Document.case),
            joinedload(DocumentVersion.creator),
            joinedload(DocumentVersion.approver),
            joinedload(DocumentVersion.parent),
        )
        .where(DocumentVersion.id == version_id)
    )
    if version is None or version.document is None or version.document.case is None:
        raise AppError(404, "not_found", "Document version not found.")
    _require_visible(user, version.document)
    enforce(authorize(user, Action.READ, ResourceType.REVISION, resource=version, case=version.document.case))
    return version


def _load(db: Session, version_id: uuid.UUID) -> DocumentVersion | None:
    return db.scalar(
        select(DocumentVersion)
        .options(
            joinedload(DocumentVersion.document).joinedload(Document.case),
            joinedload(DocumentVersion.creator),
            joinedload(DocumentVersion.approver),
            joinedload(DocumentVersion.parent),
        )
        .where(DocumentVersion.id == version_id)
    )


def _summary(user: User, version: DocumentVersion) -> VersionSummary:
    parent = version.parent
    return VersionSummary(
        id=version.id,
        document_id=version.document_id,
        version_number=version.version_number,
        version_label=version.version_label,
        status=version.status,
        change_summary=version.change_summary,
        is_official=version.is_official,
        created_by_name=version.creator.full_name if version.creator is not None else "",
        created_at=version.created_at,
        approved_by_name=version.approver.full_name if version.approver is not None else None,
        approved_at=version.approved_at,
        review_comment=version.review_comment,
        parent_version_id=version.parent_version_id,
        parent_version_number=parent.version_number if parent is not None else None,
        sha256_hash=version.sha256_hash,
        hash_algorithm=version.hash_algorithm,
        original_filename=version.original_filename,
        mime_type=version.mime_type,
        file_size=version.file_size,
        allowed_actions=_actions(user, version),
    )


def _detail(user: User, version: DocumentVersion) -> VersionDetail:
    excerpt = _text(version)
    if excerpt is not None and len(excerpt) > 12000:
        excerpt = excerpt[:12000]
    return VersionDetail(**_summary(user, version).model_dump(), submitted_at=version.submitted_at, text_excerpt=excerpt)


def _actions(user: User, version: DocumentVersion) -> list[str]:
    actions = ["DOWNLOAD"]
    document = version.document
    case = document.case if document is not None else None
    if version.parent_version_id is not None:
        actions.append("DIFF")
    if version.status == DocumentVersionStatus.DRAFT.value and authorize(
        user, Action.UPDATE, ResourceType.REVISION, resource=version, case=case
    ).allowed:
        actions.append("SUBMIT")
    if version.status == DocumentVersionStatus.SUBMITTED_FOR_REVIEW.value and version.created_by != user.id:
        if authorize(user, Action.APPROVE, ResourceType.REVISION, resource=version, case=case).allowed:
            actions.append("APPROVE")
        if authorize(user, Action.REJECT, ResourceType.REVISION, resource=version, case=case).allowed:
            actions.append("REJECT")
    return actions


def _index_after_revision(db: Session, document) -> None:
    try:
        from app.services.indexing_service import index_document

        index_document(db, document)
    except Exception:
        return
