"""Case documents. Authorization and file storage stay in their own services."""

import uuid
from datetime import datetime, timezone

from fastapi import UploadFile
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.authorization.permission_service import authorize, enforce, user_has_case_access
from app.authorization.policies import (
    DOCUMENT_STATUS_TRANSITIONS,
    ELEVATED_DOCUMENT_CLASSIFICATIONS,
    document_transition_action,
)
from app.constants import (
    Action,
    DocumentClassification,
    DocumentStatus,
    DocumentType,
    RequestStatus,
    ResourceType,
    RoleName,
)
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.models.access_request import AccessRequest
from app.models.case import Case
from app.models.document import Document
from app.models.user import User
from app.schemas.document import DocumentDetail, DocumentStatusUpdate, DocumentSummary, DocumentTransfer, DocumentUpdate
from app.services.case_service import require_case
from app.services.storage_service import StorageService, get_storage
from app.services.upload_validation import sha256_hex, validate_upload

HASH_ALGORITHM = "SHA-256"
PREVIEW_TYPES = {"application/pdf", "image/jpeg", "image/png"}


def list_documents(
    db: Session,
    user: User,
    case_key: str,
    *,
    document_type: DocumentType | None = None,
    classification: DocumentClassification | None = None,
    status: DocumentStatus | None = None,
    query: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[DocumentSummary], int]:
    case = require_case(db, user, case_key, Action.READ)
    enforce(authorize(user, Action.READ, ResourceType.DOCUMENT, case=case), hide_case=True)
    filters = [Document.case_id == case.id, _readable_clause(user)]
    if document_type is not None:
        filters.append(Document.document_type == document_type.value)
    if classification is not None:
        filters.append(Document.classification == classification.value)
    if status is not None:
        filters.append(Document.status == status.value)
    term = (query or "").strip()
    if term:
        pattern = f"%{term}%"
        filters.append(
            or_(
                Document.document_number.ilike(pattern),
                Document.title.ilike(pattern),
                Document.original_filename.ilike(pattern),
            )
        )
    total = db.scalar(select(func.count()).select_from(Document).where(*filters)) or 0
    rows = db.scalars(
        select(Document)
        .options(joinedload(Document.creator))
        .where(*filters)
        .order_by(Document.created_at.desc(), Document.document_number.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().all()
    return [_summary(user, row) for row in rows], total


def get_document(db: Session, user: User, document_id: uuid.UUID) -> DocumentDetail:
    document = _load(db, document_id)
    _require_visible(user, document)
    _audit(
        "DOCUMENT_VIEWED",
        user_id=user.id,
        case_id=document.case_id,
        document_id=document.id,
    )
    return _detail(user, document)


def upload_document(
    db: Session,
    user: User,
    case_key: str,
    upload: UploadFile,
    *,
    title: str,
    document_type: DocumentType,
    classification: DocumentClassification,
    description: str | None,
    storage: StorageService | None = None,
) -> DocumentDetail:
    case = require_case(db, user, case_key, Action.READ)
    content = _read_limited(upload)
    original_name, extension, mime = validate_upload(
        upload.filename,
        upload.content_type,
        content,
        get_settings().max_upload_size_mb * 1024 * 1024,
    )
    pending = _pending_document(case, user, classification, document_type)
    decision = authorize(user, Action.UPLOAD, ResourceType.DOCUMENT, resource=pending, case=case)
    if not decision.allowed:
        decision = authorize(user, Action.CREATE, ResourceType.DOCUMENT, resource=pending, case=case)
    enforce(decision)
    clean_title = title.strip()
    if len(clean_title) < 3 or len(clean_title) > 200:
        raise AppError(422, "validation_error", "Title must be between 3 and 200 characters.")
    store = storage or get_storage()
    stored_name, relative = store.save_case_document(case.case_number, extension, content)
    document = Document(
        case_id=case.id,
        document_number=_next_number(db, case.id),
        title=clean_title,
        description=description.strip() if description else None,
        document_type=document_type.value,
        classification=classification.value,
        status=DocumentStatus.DRAFT.value,
        original_filename=original_name,
        stored_filename=stored_name,
        storage_path=relative,
        mime_type=mime,
        file_size=len(content),
        file_hash=sha256_hex(content),
        hash_algorithm=HASH_ALGORITHM,
        created_by=user.id,
    )
    from app.authorization.ownership import assign_document_owner

    try:
        assign_document_owner(db, document, user.id)
    except ValueError as exc:
        raise AppError(422, "validation_error", "This document type is not available.") from exc
    db.add(document)
    try:
        db.flush()
        from app.services.revision_service import attach_initial_version

        attach_initial_version(db, document, user)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        store.delete_file(relative)
        raise AppError(409, "conflict", "A document with this number already exists.") from exc
    except Exception:
        db.rollback()
        store.delete_file(relative)
        raise
    stored = _load(db, document.id)
    if stored is None:
        store.delete_file(relative)
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    notice = _index_after_save(db, stored)
    _audit("DOCUMENT_UPLOADED", user_id=user.id, case_id=stored.case_id, document_id=stored.id)
    detail = _detail(user, stored)
    detail.search_notice = notice
    return detail


def update_document(db: Session, user: User, document_id: uuid.UUID, payload: DocumentUpdate) -> DocumentDetail:
    if payload.title is None and payload.description is None and payload.classification is None:
        raise AppError(422, "validation_error", "Provide at least one field to update.")
    document = _load(db, document_id)
    _require_visible(user, document)
    pending = _pending_document(
        document.case,
        user,
        payload.classification or DocumentClassification(document.classification),
        DocumentType(document.document_type),
    )
    pending.created_by = document.created_by
    pending.status = document.status
    pending.id = document.id
    enforce(authorize(user, Action.UPDATE, ResourceType.DOCUMENT, resource=document, case=document.case))
    if payload.classification is not None and payload.classification.value != document.classification:
        enforce(authorize(user, Action.UPDATE, ResourceType.DOCUMENT, resource=pending, case=document.case))
        document.classification = payload.classification.value
    if payload.title is not None:
        document.title = payload.title.strip()
    if payload.description is not None:
        document.description = payload.description.strip() or None
    document.updated_at = datetime.now(timezone.utc)
    db.commit()
    stored = _load(db, document.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(user, stored)


def change_status(db: Session, user: User, document_id: uuid.UUID, payload: DocumentStatusUpdate) -> DocumentDetail:
    document = _load(db, document_id)
    _require_visible(user, document)
    action = document_transition_action(document.status, payload.status.value)
    if action is None:
        raise AppError(422, "validation_error", "That status change is not allowed.")
    enforce(authorize(user, action, ResourceType.DOCUMENT, resource=document, case=document.case))
    now = datetime.now(timezone.utc)
    document.status = payload.status.value
    document.updated_at = now
    if payload.status == DocumentStatus.APPROVED:
        document.approved_by = user.id
        document.approved_at = now
    if payload.status == DocumentStatus.SEALED:
        document.sealed_at = now
        if document.approved_by is None:
            document.approved_by = user.id
            document.approved_at = now
    if payload.status == DocumentStatus.ARCHIVED:
        document.archived_at = now
    db.commit()
    stored = _load(db, document.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(user, stored)


def open_for_download(db: Session, user: User, document_id: uuid.UUID, *, inline: bool) -> tuple[str, str, str]:
    document = _load(db, document_id)
    _require_visible(user, document)
    action = Action.READ if inline else Action.DOWNLOAD
    enforce(authorize(user, action, ResourceType.DOCUMENT, resource=document, case=document.case))
    from app.services.revision_service import official_download_path

    version, path = official_download_path(db, user, document, record_download=not inline)
    if inline and version.mime_type not in PREVIEW_TYPES:
        raise AppError(415, "unsupported_media", "Preview not available. Download the document to view it.")
    if not inline:
        _audit(
            "DOCUMENT_DOWNLOADED",
            user_id=user.id,
            case_id=document.case_id,
            document_id=document.id,
            version_id=version.id,
        )
    return version.original_filename, version.mime_type, path


def delete_draft(db: Session, user: User, document_id: uuid.UUID) -> None:
    document = _load(db, document_id)
    _require_visible(user, document)
    enforce(authorize(user, Action.DELETE, ResourceType.DOCUMENT, resource=document, case=document.case))
    relative = document.storage_path
    document_id_value = document.id
    case_id = document.case_id
    db.delete(document)
    db.commit()
    get_storage().delete_file(relative)
    _audit("DOCUMENT_DELETED", user_id=user.id, case_id=case_id, document_id=document_id_value)


def _read_limited(upload: UploadFile) -> bytes:
    limit = get_settings().max_upload_size_mb * 1024 * 1024
    chunks: list[bytes] = []
    total = 0
    while True:
        piece = upload.file.read(1024 * 1024)
        if not piece:
            break
        total += len(piece)
        if total > limit:
            raise AppError(413, "payload_too_large", "The file is larger than the configured maximum.")
        chunks.append(piece)
    return b"".join(chunks)


def _load(db: Session, document_id: uuid.UUID) -> Document:
    document = db.scalar(
        select(Document)
        .options(
            joinedload(Document.case),
            joinedload(Document.creator),
            joinedload(Document.approver),
            joinedload(Document.owner_department),
            joinedload(Document.custodian),
        )
        .where(Document.id == document_id)
    )
    if document is None or document.case is None:
        raise AppError(404, "not_found", "Document not found.")
    return document


def _require_visible(user: User, document: Document) -> None:
    hidden = not user_has_case_access(user, document.case) or not _can_read_classification(user, document)
    if not hidden and not authorize(user, Action.READ, ResourceType.DOCUMENT, resource=document, case=document.case).allowed:
        hidden = True
    if hidden:
        _audit(
            "UNAUTHORIZED_DOCUMENT_ACCESS_ATTEMPT",
            user_id=user.id,
            case_id=document.case_id,
            document_id=document.id,
            metadata={"document_number": document.document_number},
        )
        raise AppError(404, "not_found", "Document not found.")


def _can_read_classification(user: User, document: Document) -> bool:
    if document.classification not in ELEVATED_DOCUMENT_CLASSIFICATIONS:
        return True
    role_name = user.role.name if user.role is not None else None
    if role_name == RoleName.POLICE_SUPERVISOR.value and document.owner_department_id == user.department_id:
        return user_has_case_access(user, document.case)
    return _grant_allows_read(user, document)


def _readable_clause(user: User):
    role_name = user.role.name if user.role is not None else None
    now = datetime.now(timezone.utc)
    granted = exists().where(
        AccessRequest.resource_id == Document.id,
        AccessRequest.requester_id == user.id,
        AccessRequest.resource_type == ResourceType.DOCUMENT.value,
        AccessRequest.requested_action == Action.READ.value,
        AccessRequest.status == RequestStatus.APPROVED.value,
        or_(AccessRequest.expires_at.is_(None), AccessRequest.expires_at > now),
    )
    ordinary = Document.classification.notin_(tuple(ELEVATED_DOCUMENT_CLASSIFICATIONS))
    if role_name == RoleName.POLICE_SUPERVISOR.value:
        return or_(ordinary, Document.owner_department_id == user.department_id, granted)
    return or_(ordinary, granted)


def _grant_allows_read(user: User, document: Document) -> bool:
    from sqlalchemy.orm import object_session

    db = object_session(user)
    if db is None:
        return False
    now = datetime.now(timezone.utc)
    grant = db.scalar(
        select(AccessRequest.id).where(
            AccessRequest.resource_id == document.id,
            AccessRequest.requester_id == user.id,
            AccessRequest.resource_type == ResourceType.DOCUMENT.value,
            AccessRequest.requested_action == Action.READ.value,
            AccessRequest.status == RequestStatus.APPROVED.value,
            or_(AccessRequest.expires_at.is_(None), AccessRequest.expires_at > now),
        )
    )
    return grant is not None


def _next_number(db: Session, case_id: uuid.UUID) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"DOC-{year}-"
    numbers = db.scalars(
        select(Document.document_number).where(
            Document.case_id == case_id,
            Document.document_number.like(f"{prefix}%"),
        )
    ).all()
    highest = 0
    for number in numbers:
        suffix = number.removeprefix(prefix)
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"{prefix}{highest + 1:06d}"


def _summary(user: User, document: Document) -> DocumentSummary:
    creator = document.creator
    return DocumentSummary(
        id=document.id,
        case_id=document.case_id,
        document_number=document.document_number,
        title=document.title,
        document_type=document.document_type,
        classification=document.classification,
        status=document.status,
        original_filename=document.original_filename,
        created_by_name=creator.full_name if creator is not None else "",
        created_at=document.created_at,
        updated_at=document.updated_at,
        allowed_status_transitions=_allowed_transitions(user, document),
    )


def _detail(user: User, document: Document) -> DocumentDetail:
    case = document.case
    approver = document.approver
    custodian = document.custodian
    custodian_name = (custodian.full_name or custodian.username) if custodian is not None else None
    owner_dept = document.owner_department
    owner_dept_name = owner_dept.name if owner_dept is not None else None
    summary = _summary(user, document)

    actions = []
    is_custodian = getattr(document, "custodian_user_id", None) == user.id
    is_supervisor = (
        user.role is not None
        and user.role.name == RoleName.POLICE_SUPERVISOR.value
        and case is not None
        and user.department_id == case.department_id
    )
    if (is_custodian or is_supervisor) and document.status not in {DocumentStatus.SEALED.value, DocumentStatus.ARCHIVED.value}:
        actions.append("TRANSFER")

    return DocumentDetail(
        **summary.model_dump(),
        description=document.description,
        mime_type=document.mime_type,
        file_size=document.file_size,
        file_hash=document.file_hash,
        hash_algorithm=document.hash_algorithm,
        created_by=document.created_by,
        approved_by=document.approved_by,
        approved_by_name=approver.full_name if approver is not None else None,
        approved_at=document.approved_at,
        sealed_at=document.sealed_at,
        archived_at=document.archived_at,
        case_number=case.case_number if case is not None else "",
        case_title=case.title if case is not None else "",
        owner_department_code=owner_dept.code if owner_dept is not None else None,
        owner_department_name=owner_dept_name,
        custodian_user_id=document.custodian_user_id,
        custodian_name=custodian_name,
        official_version_number=_official_number(document),
        official_version_label=_official_label(document),
        allowed_actions=actions,
    )


def transfer_document(
    db: Session,
    user: User,
    document_id: uuid.UUID,
    payload: DocumentTransfer,
) -> DocumentDetail:
    document = _load(db, document_id)
    _require_visible(user, document)
    if document.status in {DocumentStatus.SEALED.value, DocumentStatus.ARCHIVED.value}:
        raise AppError(403, "forbidden", "Sealed or archived documents cannot be transferred.")

    is_custodian = document.custodian_user_id == user.id
    is_supervisor = (
        user.role is not None
        and user.role.name == RoleName.POLICE_SUPERVISOR.value
        and document.case is not None
        and user.department_id == document.case.department_id
    )
    if not (is_custodian or is_supervisor):
        raise AppError(403, "forbidden", "Only the current custodian or supervisor can transfer document custody.")

    recipient = db.get(User, payload.to_user_id)
    if recipient is None or not recipient.is_active:
        raise AppError(422, "validation_error", "Recipient user not found or inactive.")

    prev_custodian = document.custodian or db.get(User, document.custodian_user_id)
    prev_id = prev_custodian.id if prev_custodian else document.custodian_user_id

    document.custodian_user_id = recipient.id
    document.custodian = recipient
    db.commit()
    db.refresh(document)

    _audit(
        "DOCUMENT_CUSTODY_TRANSFERRED",
        user_id=user.id,
        case_id=document.case_id,
        document_id=document.id,
        metadata={
            "from_user_id": str(prev_id),
            "to_user_id": str(recipient.id),
            "reason": payload.reason.strip(),
        },
    )
    return _detail(user, document)


def _allowed_transitions(user: User, document: Document) -> list[str]:
    allowed = []
    for target in sorted(DOCUMENT_STATUS_TRANSITIONS.get(document.status, ())):
        action = document_transition_action(document.status, target)
        if action is None:
            continue
        if authorize(user, action, ResourceType.DOCUMENT, resource=document, case=document.case).allowed:
            allowed.append(target)
    return allowed


class _Pending:
    def __init__(
        self,
        case: Case,
        user: User,
        classification: DocumentClassification,
        document_type: DocumentType,
    ) -> None:
        self.id = None
        self.case_id = case.id
        self.case = case
        self.classification = classification.value
        self.status = DocumentStatus.DRAFT.value
        self.created_by = user.id
        self.document_type = document_type.value


def _pending_document(
    case: Case,
    user: User,
    classification: DocumentClassification,
    document_type: DocumentType,
) -> _Pending:
    return _Pending(case, user, classification, document_type)


def _official_number(document: Document) -> int | None:
    version = _official_row(document)
    return version.version_number if version is not None else None


def _official_label(document: Document) -> str | None:
    version = _official_row(document)
    return version.version_label if version is not None else None


def _official_row(document: Document):
    from sqlalchemy.orm import object_session

    from app.models.document_version import DocumentVersion

    session = object_session(document)
    if session is None:
        return None
    return session.scalar(
        select(DocumentVersion).where(DocumentVersion.document_id == document.id, DocumentVersion.is_official.is_(True))
    )


def _audit(event_type: str, **fields) -> None:
    from app.services.audit_service import record

    record(event_type, **fields)


def _index_after_save(db: Session, document: Document) -> str | None:
    try:
        from app.services.indexing_service import index_document

        return index_document(db, document).notice
    except Exception:
        return "Document uploaded successfully, but search indexing is currently unavailable."
