"""Immutable original evidence and derived-artifact provenance."""

import uuid
from datetime import datetime, timezone

from fastapi import UploadFile
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, object_session

from app.authorization.permission_service import (
    authorize,
    enforce,
    user_has_case_access,
    user_has_forensic_evidence_access,
)
from app.authorization.policies import ELEVATED_DOCUMENT_CLASSIFICATIONS, EVIDENCE_STATUS_TRANSITIONS
from app.constants import (
    Action,
    ArtifactStatus,
    ArtifactType,
    CaseStatus,
    CustodyEventType,
    DocumentClassification,
    EvidenceStatus,
    EvidenceType,
    IntegrityStatus,
    RequestStatus,
    ResourceType,
    RoleName,
)
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.models.access_request import AccessRequest
from app.models.case import Case
from app.models.case_assignment import CaseAssignment
from app.models.evidence import DerivedArtifact, Evidence, EvidenceIntegrityEvent
from app.models.user import User
from app.schemas.evidence import (
    ArtifactSummary,
    EvidenceDetail,
    EvidenceSummary,
    EvidenceTransfer,
    IntegrityResult,
    ProvenanceNode,
    ProvenanceResponse,
)
from app.services.case_service import require_case
from app.services.storage_service import get_storage
from app.services.upload_validation import sha256_hex, validate_evidence_upload

HASH_ALGORITHM = "SHA-256"


def list_evidence(
    db: Session,
    user: User,
    case_key: str,
    *,
    evidence_type: EvidenceType | None = None,
    classification: DocumentClassification | None = None,
    status: EvidenceStatus | None = None,
    query: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[EvidenceSummary], int]:
    case = require_case(db, user, case_key, Action.READ)
    enforce(authorize(user, Action.READ, ResourceType.EVIDENCE, case=case), hide_case=True)
    filters = [Evidence.case_id == case.id, _readable_clause(user, Evidence.classification, Evidence.id, ResourceType.EVIDENCE)]
    if evidence_type is not None:
        filters.append(Evidence.evidence_type == evidence_type.value)
    if classification is not None:
        filters.append(Evidence.classification == classification.value)
    if status is not None:
        filters.append(Evidence.status == status.value)
    term = (query or "").strip()
    if term:
        pattern = f"%{term}%"
        filters.append(
            or_(
                Evidence.evidence_number.ilike(pattern),
                Evidence.title.ilike(pattern),
                Evidence.original_filename.ilike(pattern),
            )
        )
    total = db.scalar(select(func.count()).select_from(Evidence).where(*filters)) or 0
    rows = db.scalars(
        select(Evidence)
        .options(joinedload(Evidence.creator), joinedload(Evidence.case))
        .where(*filters)
        .order_by(Evidence.created_at.desc(), Evidence.evidence_number.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().all()
    return [_summary(user, row) for row in rows], total


def get_evidence(db: Session, user: User, evidence_id: uuid.UUID) -> EvidenceDetail:
    evidence = _load_evidence(db, evidence_id)
    _require_visible(user, evidence)
    _audit("EVIDENCE_VIEWED", user_id=user.id, case_id=evidence.case_id, evidence_id=evidence.id)
    return _detail(db, user, evidence)


def upload_evidence(
    db: Session,
    user: User,
    case_key: str,
    upload: UploadFile,
    *,
    title: str,
    evidence_type: EvidenceType,
    classification: DocumentClassification,
    description: str | None,
) -> EvidenceDetail:
    case = require_case(db, user, case_key, Action.READ)
    content = _read_limited(upload)
    original_name, extension, mime = validate_evidence_upload(
        upload.filename,
        upload.content_type,
        content,
        get_settings().max_upload_size_mb * 1024 * 1024,
    )
    pending = _Pending(case, classification, created_by=user.id)
    decision = authorize(user, Action.UPLOAD, ResourceType.EVIDENCE, resource=pending, case=case)
    if not decision.allowed:
        decision = authorize(user, Action.CREATE, ResourceType.EVIDENCE, resource=pending, case=case)
    enforce(decision)
    clean_title = title.strip()
    if len(clean_title) < 3 or len(clean_title) > 200:
        raise AppError(422, "validation_error", "Title must be between 3 and 200 characters.")
    digest = sha256_hex(content)
    stored_name, relative, encrypted = _store_original(case.case_number, extension, content, digest)
    evidence = Evidence(
        case_id=case.id,
        evidence_number=_next_number(db, Evidence, Evidence.case_id, Evidence.evidence_number, case.id, "EVD"),
        title=clean_title,
        description=description.strip() if description else None,
        evidence_type=evidence_type.value,
        classification=classification.value,
        status=EvidenceStatus.RECEIVED.value,
        original_filename=original_name,
        stored_filename=stored_name,
        storage_path=relative,
        mime_type=mime,
        file_size=len(content),
        sha256_hash=digest,
        hash_algorithm=HASH_ALGORITHM,
        storage_encrypted=encrypted,
        created_by=user.id,
        custodian_user_id=user.id,
    )
    db.add(evidence)
    try:
        db.flush()
        from app.services.custody_service import record_event

        record_event(
            db,
            case_id=case.id,
            evidence_id=evidence.id,
            event_type=CustodyEventType.EVIDENCE_UPLOADED,
            performed_by=user.id,
            description="Evidence uploaded.",
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        get_storage().delete_file(relative)
        raise AppError(409, "conflict", "An evidence item with this number already exists.") from exc
    except Exception:
        db.rollback()
        get_storage().delete_file(relative)
        raise
    stored = _load_evidence(db, evidence.id)
    if stored is None:
        get_storage().delete_file(relative)
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    _index_evidence_quietly(db, stored)
    _audit("EVIDENCE_UPLOADED", user_id=user.id, case_id=stored.case_id, evidence_id=stored.id)
    return _detail(db, user, stored)


def verify_status(db: Session, user: User, evidence_id: uuid.UUID) -> EvidenceDetail:
    evidence = _load_evidence(db, evidence_id)
    _require_visible(user, evidence)
    if "VERIFIED" not in EVIDENCE_STATUS_TRANSITIONS.get(evidence.status, frozenset()):
        raise AppError(422, "validation_error", "That status change is not allowed.")
    enforce(authorize(user, Action.VERIFY, ResourceType.EVIDENCE, resource=evidence, case=evidence.case))
    evidence.status = EvidenceStatus.VERIFIED.value
    db.commit()
    stored = _load_evidence(db, evidence.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(db, user, stored)


def seal_evidence(db: Session, user: User, evidence_id: uuid.UUID) -> EvidenceDetail:
    evidence = _load_evidence(db, evidence_id)
    _require_visible(user, evidence)
    if "SEALED" not in EVIDENCE_STATUS_TRANSITIONS.get(evidence.status, frozenset()):
        raise AppError(422, "validation_error", "That status change is not allowed.")
    enforce(authorize(user, Action.APPROVE, ResourceType.EVIDENCE, resource=evidence, case=evidence.case))
    evidence.status = EvidenceStatus.SEALED.value
    evidence.sealed_at = datetime.now(timezone.utc)
    from app.services.custody_service import record_event

    record_event(
        db,
        case_id=evidence.case_id,
        evidence_id=evidence.id,
        event_type=CustodyEventType.EVIDENCE_SEALED,
        performed_by=user.id,
        description="Evidence sealed.",
    )
    db.commit()
    stored = _load_evidence(db, evidence.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(db, user, stored)


def archive_evidence(db: Session, user: User, evidence_id: uuid.UUID) -> EvidenceDetail:
    evidence = _load_evidence(db, evidence_id)
    _require_visible(user, evidence)
    if "ARCHIVED" not in EVIDENCE_STATUS_TRANSITIONS.get(evidence.status, frozenset()):
        raise AppError(422, "validation_error", "That status change is not allowed.")
    enforce(authorize(user, Action.APPROVE, ResourceType.EVIDENCE, resource=evidence, case=evidence.case))
    evidence.status = EvidenceStatus.ARCHIVED.value
    db.commit()
    stored = _load_evidence(db, evidence.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(db, user, stored)


def check_evidence_integrity(db: Session, user: User, evidence_id: uuid.UUID) -> IntegrityResult:
    evidence = _load_evidence(db, evidence_id)
    _require_visible(user, evidence)
    _require_read_or_verify(user, evidence)
    return _compare_and_record(
        db,
        user,
        case_id=evidence.case_id,
        evidence_id=evidence.id,
        artifact_id=None,
        relative_path=evidence.storage_path,
        stored_hash=evidence.sha256_hash,
        encrypted=evidence.storage_encrypted,
    )


def list_chain_of_custody(db: Session, user: User, evidence_id: uuid.UUID):
    evidence = _load_evidence(db, evidence_id)
    _require_visible(user, evidence)
    enforce(authorize(user, Action.READ, ResourceType.EVIDENCE, resource=evidence, case=evidence.case))
    from app.services.custody_service import list_events

    return list_events(db, evidence.id)


def open_evidence_download(db: Session, user: User, evidence_id: uuid.UUID) -> tuple[Evidence, str, bool]:
    evidence = _load_evidence(db, evidence_id)
    _require_visible(user, evidence)
    enforce(authorize(user, Action.DOWNLOAD, ResourceType.EVIDENCE, resource=evidence, case=evidence.case))
    result = _compare_and_record(
        db,
        user,
        case_id=evidence.case_id,
        evidence_id=evidence.id,
        artifact_id=None,
        relative_path=evidence.storage_path,
        stored_hash=evidence.sha256_hash,
        encrypted=evidence.storage_encrypted,
    )
    if result.integrity_status != IntegrityStatus.VERIFIED.value:
        raise AppError(409, "conflict", "The original evidence failed its integrity check. Download is blocked.")
    from app.services.custody_service import record_event

    record_event(
        db,
        case_id=evidence.case_id,
        evidence_id=evidence.id,
        event_type=CustodyEventType.EVIDENCE_DOWNLOADED,
        performed_by=user.id,
        description="Evidence downloaded.",
    )
    db.commit()
    _audit("EVIDENCE_DOWNLOADED", user_id=user.id, case_id=evidence.case_id, evidence_id=evidence.id)
    path, temporary = _plaintext_path(evidence.storage_path, evidence.storage_encrypted)
    return evidence, path, temporary


def provenance(db: Session, user: User, evidence_id: uuid.UUID) -> ProvenanceResponse:
    evidence = _load_evidence(db, evidence_id)
    _require_visible(user, evidence)
    rows = db.scalars(
        select(DerivedArtifact)
        .options(joinedload(DerivedArtifact.creator))
        .where(DerivedArtifact.source_evidence_id == evidence.id, DerivedArtifact.case_id == evidence.case_id)
        .order_by(DerivedArtifact.created_at.asc())
    ).unique().all()
    visible = [row for row in rows if _artifact_visible(user, row)]
    return ProvenanceResponse(
        evidence_id=evidence.id,
        evidence_number=evidence.evidence_number,
        title=evidence.title,
        evidence_type=evidence.evidence_type,
        sha256_hash=evidence.sha256_hash,
        hash_algorithm=evidence.hash_algorithm,
        status=evidence.status,
        artifacts=_tree(visible),
    )


def create_artifact_from_evidence(
    db: Session,
    user: User,
    evidence_id: uuid.UUID,
    upload: UploadFile,
    *,
    title: str,
    artifact_type: ArtifactType,
    processing_description: str,
    description: str | None,
    source_artifact_id: uuid.UUID | None = None,
    forensic_request_id: uuid.UUID | None = None,
    integrity_message: str | None = None,
) -> ArtifactSummary:
    evidence = _load_evidence(db, evidence_id)
    _require_visible(user, evidence)
    parent = None
    if source_artifact_id is not None:
        parent = _load_artifact(db, source_artifact_id)
        if parent.case_id != evidence.case_id or parent.source_evidence_id != evidence.id:
            raise AppError(422, "validation_error", "The source artifact does not belong to this evidence.")
        _require_artifact_visible(user, parent)
        _assert_source_intact(db, user, parent, integrity_message)
    _assert_source_intact(db, user, evidence, integrity_message)
    return _create_artifact(
        db,
        user,
        evidence,
        parent,
        upload,
        title=title,
        artifact_type=artifact_type,
        processing_description=processing_description,
        description=description,
        forensic_request_id=forensic_request_id,
    )


def create_artifact_from_artifact(
    db: Session,
    user: User,
    artifact_id: uuid.UUID,
    upload: UploadFile,
    *,
    title: str,
    artifact_type: ArtifactType,
    processing_description: str,
    description: str | None,
) -> ArtifactSummary:
    parent = _load_artifact(db, artifact_id)
    evidence = _load_evidence(db, parent.source_evidence_id)
    _require_visible(user, evidence)
    _require_artifact_visible(user, parent)
    if parent.case_id != evidence.case_id:
        raise AppError(422, "validation_error", "The source artifact does not belong to this case.")
    _assert_source_intact(db, user, evidence)
    _assert_source_intact(db, user, parent)
    return _create_artifact(
        db,
        user,
        evidence,
        parent,
        upload,
        title=title,
        artifact_type=artifact_type,
        processing_description=processing_description,
        description=description,
    )


def get_artifact(db: Session, user: User, artifact_id: uuid.UUID) -> ArtifactSummary:
    artifact = _load_artifact(db, artifact_id)
    _require_artifact_visible(user, artifact)
    return _artifact_summary(artifact)


def check_artifact_integrity(db: Session, user: User, artifact_id: uuid.UUID) -> IntegrityResult:
    artifact = _load_artifact(db, artifact_id)
    _require_artifact_visible(user, artifact)
    return _compare_and_record(
        db,
        user,
        case_id=artifact.case_id,
        evidence_id=None,
        artifact_id=artifact.id,
        relative_path=artifact.storage_path,
        stored_hash=artifact.sha256_hash,
        encrypted=artifact.storage_encrypted,
    )


def open_artifact_download(db: Session, user: User, artifact_id: uuid.UUID) -> tuple[DerivedArtifact, str, bool]:
    artifact = _load_artifact(db, artifact_id)
    _require_artifact_visible(user, artifact)
    enforce(authorize(user, Action.DOWNLOAD, ResourceType.DERIVED_ARTIFACT, resource=artifact, case=artifact.case))
    result = _compare_and_record(
        db,
        user,
        case_id=artifact.case_id,
        evidence_id=None,
        artifact_id=artifact.id,
        relative_path=artifact.storage_path,
        stored_hash=artifact.sha256_hash,
        encrypted=artifact.storage_encrypted,
    )
    if result.integrity_status != IntegrityStatus.VERIFIED.value:
        raise AppError(409, "conflict", "The derived artifact failed its integrity check. Download is blocked.")
    path, temporary = _plaintext_path(artifact.storage_path, artifact.storage_encrypted)
    return artifact, path, temporary


def _create_artifact(
    db: Session,
    user: User,
    evidence: Evidence,
    parent: DerivedArtifact | None,
    upload: UploadFile,
    *,
    title: str,
    artifact_type: ArtifactType,
    processing_description: str,
    description: str | None,
    forensic_request_id: uuid.UUID | None = None,
) -> ArtifactSummary:
    clean_processing = processing_description.strip()
    if len(clean_processing) < 10:
        raise AppError(422, "validation_error", "Describe how this artifact was produced.")
    clean_title = title.strip()
    if len(clean_title) < 3 or len(clean_title) > 200:
        raise AppError(422, "validation_error", "Title must be between 3 and 200 characters.")
    content = _read_limited(upload)
    original_name, extension, mime = validate_evidence_upload(
        upload.filename,
        upload.content_type,
        content,
        get_settings().max_upload_size_mb * 1024 * 1024,
    )
    pending = _Pending(evidence.case, DocumentClassification(evidence.classification), created_by=user.id)
    decision = authorize(user, Action.CREATE, ResourceType.DERIVED_ARTIFACT, resource=pending, case=evidence.case)
    if not decision.allowed:
        decision = authorize(user, Action.UPLOAD, ResourceType.DERIVED_ARTIFACT, resource=pending, case=evidence.case)
    enforce(decision)
    if parent is not None:
        _assert_no_cycle(db, parent.id)
    digest = sha256_hex(content)
    stored_name, relative, encrypted = _store_derived(evidence.case.case_number, extension, content, digest)
    artifact = DerivedArtifact(
        case_id=evidence.case_id,
        source_evidence_id=evidence.id,
        source_artifact_id=parent.id if parent is not None else None,
        artifact_number=_next_number(db, DerivedArtifact, DerivedArtifact.case_id, DerivedArtifact.artifact_number, evidence.case_id, "ART"),
        title=clean_title,
        description=description.strip() if description else None,
        artifact_type=artifact_type.value,
        processing_description=clean_processing,
        classification=evidence.classification,
        status=ArtifactStatus.RECORDED.value,
        original_filename=original_name,
        stored_filename=stored_name,
        storage_path=relative,
        mime_type=mime,
        file_size=len(content),
        sha256_hash=digest,
        hash_algorithm=HASH_ALGORITHM,
        storage_encrypted=encrypted,
        created_by=user.id,
        forensic_request_id=forensic_request_id,
    )
    db.add(artifact)
    try:
        db.flush()
        from app.services.custody_service import record_event

        record_event(
            db,
            case_id=evidence.case_id,
            evidence_id=evidence.id,
            request_id=forensic_request_id,
            event_type=CustodyEventType.DERIVED_ARTIFACT_CREATED,
            performed_by=user.id,
            description=f"Derived artifact {artifact.artifact_number} created.",
            metadata={"artifact_id": str(artifact.id), "artifact_number": artifact.artifact_number},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        get_storage().delete_file(relative)
        raise AppError(409, "conflict", "An artifact with this number already exists.") from exc
    except Exception:
        db.rollback()
        get_storage().delete_file(relative)
        raise
    stored = _load_artifact(db, artifact.id)
    if stored is None:
        get_storage().delete_file(relative)
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    _index_artifact_quietly(db, stored)
    _audit(
        "EVIDENCE_DERIVED",
        user_id=user.id,
        case_id=stored.case_id,
        evidence_id=stored.source_evidence_id,
        metadata={"artifact_id": str(stored.id)},
    )
    return _artifact_summary(stored)


def _store_original(case_number: str, extension: str, content: bytes, digest: str) -> tuple[str, str, bool]:
    from app.core.file_crypto import protect_new_bytes, read_plaintext

    storage = get_storage()
    stored, encrypted = protect_new_bytes(content)
    stored_name, relative = storage.save_original_evidence(case_number, extension, stored)
    return _confirm_hash(storage, stored_name, relative, digest, encrypted, read_plaintext)


def _store_derived(case_number: str, extension: str, content: bytes, digest: str) -> tuple[str, str, bool]:
    from app.core.file_crypto import protect_new_bytes, read_plaintext

    storage = get_storage()
    stored, encrypted = protect_new_bytes(content)
    stored_name, relative = storage.save_derived_artifact(case_number, extension, stored)
    return _confirm_hash(storage, stored_name, relative, digest, encrypted, read_plaintext)


def _confirm_hash(storage, stored_name: str, relative: str, digest: str, encrypted: bool, read_plaintext) -> tuple[str, str, bool]:
    written = read_plaintext(storage.get_file(relative).read_bytes(), encrypted)
    if sha256_hex(written) != digest:
        storage.delete_file(relative)
        raise AppError(500, "internal_error", "The stored file did not match its hash.")
    return stored_name, relative, encrypted


def _assert_source_intact(
    db: Session,
    user: User,
    source: Evidence | DerivedArtifact,
    message: str | None = None,
) -> None:
    evidence_id = source.id if isinstance(source, Evidence) else None
    artifact_id = source.id if isinstance(source, DerivedArtifact) else None
    result = _compare_and_record(
        db,
        user,
        case_id=source.case_id,
        evidence_id=evidence_id,
        artifact_id=artifact_id,
        relative_path=source.storage_path,
        stored_hash=source.sha256_hash,
        encrypted=source.storage_encrypted,
    )
    if result.integrity_status != IntegrityStatus.VERIFIED.value:
        raise AppError(409, "conflict", message or "Source integrity check failed. Processing is blocked.")


def _assert_no_cycle(db: Session, start_id: uuid.UUID) -> None:
    seen: set[uuid.UUID] = set()
    current: uuid.UUID | None = start_id
    while current is not None:
        if current in seen:
            raise AppError(422, "validation_error", "This provenance link would create a cycle.")
        seen.add(current)
        parent_id = db.scalar(select(DerivedArtifact.source_artifact_id).where(DerivedArtifact.id == current))
        current = parent_id


def _plaintext_path(relative_path: str, encrypted: bool) -> tuple[str, bool]:
    import tempfile

    from app.core.file_crypto import read_plaintext

    path = get_storage().get_file(relative_path)
    if not encrypted:
        return str(path), False
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=path.suffix)
    try:
        handle.write(read_plaintext(path.read_bytes(), True))
    finally:
        handle.close()
    return handle.name, True


def _compare_and_record(
    db: Session,
    user: User,
    *,
    case_id: uuid.UUID,
    evidence_id: uuid.UUID | None,
    artifact_id: uuid.UUID | None,
    relative_path: str,
    stored_hash: str,
    encrypted: bool = False,
) -> IntegrityResult:
    from app.core.file_crypto import read_plaintext

    path = get_storage().get_file(relative_path)
    current = sha256_hex(read_plaintext(path.read_bytes(), encrypted))
    status = IntegrityStatus.VERIFIED.value if current == stored_hash else IntegrityStatus.INTEGRITY_MISMATCH.value
    db.add(
        EvidenceIntegrityEvent(
            case_id=case_id,
            evidence_id=evidence_id,
            artifact_id=artifact_id,
            stored_hash=stored_hash,
            current_hash=current,
            integrity_status=status,
            checked_by=user.id,
        )
    )
    if status == IntegrityStatus.VERIFIED.value and evidence_id is not None:
        from app.services.custody_service import record_event

        record_event(
            db,
            case_id=case_id,
            evidence_id=evidence_id,
            event_type=CustodyEventType.EVIDENCE_VERIFIED,
            performed_by=user.id,
            description="Integrity verified.",
        )
    db.commit()
    return IntegrityResult(
        evidence_id=evidence_id,
        artifact_id=artifact_id,
        algorithm=HASH_ALGORITHM,
        stored_hash=stored_hash,
        current_hash=current,
        integrity_status=status,
    )


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


def _load_evidence(db: Session, evidence_id: uuid.UUID) -> Evidence:
    evidence = db.scalar(
        select(Evidence)
        .options(
            joinedload(Evidence.case),
            joinedload(Evidence.creator),
            joinedload(Evidence.custodian),
        )
        .where(Evidence.id == evidence_id)
    )
    if evidence is None or evidence.case is None:
        raise AppError(404, "not_found", "Evidence not found.")
    return evidence


def _load_artifact(db: Session, artifact_id: uuid.UUID) -> DerivedArtifact:
    artifact = db.scalar(
        select(DerivedArtifact)
        .options(joinedload(DerivedArtifact.case), joinedload(DerivedArtifact.creator), joinedload(DerivedArtifact.source_evidence))
        .where(DerivedArtifact.id == artifact_id)
    )
    if artifact is None or artifact.case is None:
        raise AppError(404, "not_found", "Derived artifact not found.")
    return artifact


def _require_visible(user: User, evidence: Evidence) -> None:
    hidden = not user_has_case_access(user, evidence.case) or not _can_read_classification(user, evidence, ResourceType.EVIDENCE)
    if not hidden and not authorize(user, Action.READ, ResourceType.EVIDENCE, resource=evidence, case=evidence.case).allowed:
        hidden = True
    if hidden:
        _audit(
            "UNAUTHORIZED_ACCESS_ATTEMPT",
            user_id=user.id,
            case_id=evidence.case_id,
            evidence_id=evidence.id,
            metadata={"evidence_number": evidence.evidence_number},
        )
        raise AppError(404, "not_found", "Evidence not found.")


def _audit(event_type: str, **fields) -> None:
    from app.services.audit_service import record

    record(event_type, **fields)


def _require_artifact_visible(user: User, artifact: DerivedArtifact) -> None:
    if not user_has_case_access(user, artifact.case) or not _can_read_classification(user, artifact, ResourceType.DERIVED_ARTIFACT):
        raise AppError(404, "not_found", "Derived artifact not found.")
    if not authorize(user, Action.READ, ResourceType.DERIVED_ARTIFACT, resource=artifact, case=artifact.case).allowed:
        raise AppError(404, "not_found", "Derived artifact not found.")


def _require_read_or_verify(user: User, evidence: Evidence) -> None:
    if authorize(user, Action.VERIFY, ResourceType.EVIDENCE, resource=evidence, case=evidence.case).allowed:
        return
    if authorize(user, Action.READ, ResourceType.EVIDENCE, resource=evidence, case=evidence.case).allowed:
        return
    enforce(authorize(user, Action.VERIFY, ResourceType.EVIDENCE, resource=evidence, case=evidence.case))


def _artifact_visible(user: User, artifact: DerivedArtifact) -> bool:
    try:
        _require_artifact_visible(user, artifact)
    except AppError:
        return False
    return True


def _can_prosecutor_read_evidence(user: User, resource, resource_type: ResourceType) -> bool:
    if _grant_allows_read(user, resource, resource_type):
        return True
    custodian_id = getattr(resource, "custodian_user_id", None)
    if custodian_id is None and hasattr(resource, "source_evidence"):
        custodian_id = getattr(getattr(resource, "source_evidence", None), "custodian_user_id", None)
    if custodian_id is not None and custodian_id == user.id:
        return True
    if getattr(resource, "classification", None) in ELEVATED_DOCUMENT_CLASSIFICATIONS:
        return False
    case = getattr(resource, "case", None)
    case_status = getattr(case, "status", None)
    if case_status in {CaseStatus.READY_FOR_PROSECUTION.value, CaseStatus.IN_COURT.value}:
        return True
    case_id = getattr(resource, "case_id", None)
    if case_id is not None:
        db = object_session(user) or object_session(resource)
        if db is not None:
            if case_status is None:
                loaded_status = db.scalar(select(Case.status).where(Case.id == case_id))
                if loaded_status in {CaseStatus.READY_FOR_PROSECUTION.value, CaseStatus.IN_COURT.value}:
                    return True
            assigned = db.scalar(
                select(CaseAssignment.id).where(
                    CaseAssignment.case_id == case_id,
                    CaseAssignment.user_id == user.id,
                    CaseAssignment.active.is_(True),
                )
            )
            if assigned is not None:
                return True
    return False


def _can_read_classification(user: User, resource, resource_type: ResourceType) -> bool:
    role_name = user.role.name if user.role is not None else None
    if role_name in {RoleName.FORENSIC_EXAMINER.value, RoleName.FORENSIC_REVIEWER.value}:
        return user_has_forensic_evidence_access(user, resource, Action.READ)
    if role_name == RoleName.PROSECUTOR.value:
        return _can_prosecutor_read_evidence(user, resource, resource_type)
    if role_name == RoleName.JUDICIAL_USER.value:
        return _grant_allows_read(user, resource, resource_type) or _package_allows(resource)
    if getattr(resource, "classification", None) not in ELEVATED_DOCUMENT_CLASSIFICATIONS:
        return True
    if role_name == RoleName.POLICE_SUPERVISOR.value:
        return user_has_case_access(user, resource.case)
    return _grant_allows_read(user, resource, resource_type)


def _package_allows(resource) -> bool:
    from sqlalchemy.orm import object_session

    from app.models.court_package import CourtPackage, CourtPackageItem

    db = object_session(resource)
    resource_id = getattr(resource, "id", None)
    if db is None or resource_id is None:
        return False
    evidence_id = resource_id if resource.__class__.__name__ == "Evidence" else getattr(resource, "source_evidence_id", None)
    artifact_id = resource_id if resource.__class__.__name__ == "DerivedArtifact" else None
    filters = [CourtPackage.status.in_(("SUBMITTED", "VERIFIED", "MISMATCH"))]
    matches = []
    if evidence_id is not None:
        matches.append(CourtPackageItem.evidence_id == evidence_id)
    if artifact_id is not None:
        matches.append(CourtPackageItem.artifact_id == artifact_id)
    if not matches:
        return False
    row = db.scalar(
        select(CourtPackageItem.id).join(CourtPackage, CourtPackage.id == CourtPackageItem.package_id).where(*filters, or_(*matches))
    )
    return row is not None


def _readable_clause(user: User, classification_column, id_column, resource_type: ResourceType):
    role_name = user.role.name if user.role is not None else None
    now = datetime.now(timezone.utc)
    granted = exists().where(
        AccessRequest.resource_id == id_column,
        AccessRequest.requester_id == user.id,
        AccessRequest.resource_type == resource_type.value,
        AccessRequest.requested_action == Action.READ.value,
        AccessRequest.status == RequestStatus.APPROVED.value,
        or_(AccessRequest.expires_at.is_(None), AccessRequest.expires_at > now),
    )
    if role_name == RoleName.POLICE_SUPERVISOR.value:
        return classification_column.is_not(None)
    if role_name in {RoleName.FORENSIC_EXAMINER.value, RoleName.FORENSIC_REVIEWER.value}:
        return _forensic_clause(user, id_column, resource_type)
    if role_name == RoleName.PROSECUTOR.value:
        assigned_to_case = exists().where(
            CaseAssignment.case_id == Evidence.case_id,
            CaseAssignment.user_id == user.id,
            CaseAssignment.active.is_(True),
        )
        case_in_prosecution = exists().where(
            Case.id == Evidence.case_id,
            Case.status.in_((CaseStatus.READY_FOR_PROSECUTION.value, CaseStatus.IN_COURT.value)),
        )
        non_elevated = classification_column.notin_(tuple(ELEVATED_DOCUMENT_CLASSIFICATIONS))
        custodian_match = (Evidence.custodian_user_id == user.id)
        return or_(
            granted,
            custodian_match,
            and_(non_elevated, or_(case_in_prosecution, assigned_to_case)),
        )
    if role_name == RoleName.JUDICIAL_USER.value:
        return or_(granted, _package_clause(id_column, resource_type))
    return or_(classification_column.notin_(tuple(ELEVATED_DOCUMENT_CLASSIFICATIONS)), granted)


def _forensic_clause(user: User, id_column, resource_type: ResourceType):
    from app.authorization.policies import EXAMINATION_STATUSES, REVIEW_VISIBLE_STATUSES
    from app.models.forensic import ForensicRequest, ForensicRequestEvidence

    role_name = user.role.name if user.role is not None else None
    statuses = EXAMINATION_STATUSES if role_name == RoleName.FORENSIC_EXAMINER.value else REVIEW_VISIBLE_STATUSES
    filters = [
        ForensicRequest.id == ForensicRequestEvidence.request_id,
        ForensicRequest.status.in_(tuple(statuses)),
    ]
    if role_name == RoleName.FORENSIC_EXAMINER.value:
        filters.append(ForensicRequest.assigned_to == user.id)
    if resource_type == ResourceType.DERIVED_ARTIFACT:
        filters.append(DerivedArtifact.id == id_column)
        filters.append(ForensicRequestEvidence.evidence_id == DerivedArtifact.source_evidence_id)
        return exists().where(*filters)
    filters.append(ForensicRequestEvidence.evidence_id == id_column)
    return exists().where(*filters)


def _package_clause(id_column, resource_type: ResourceType):
    from app.models.court_package import CourtPackage, CourtPackageItem

    link = CourtPackageItem.artifact_id == id_column if resource_type == ResourceType.DERIVED_ARTIFACT else CourtPackageItem.evidence_id == id_column
    return exists().where(
        link,
        CourtPackage.id == CourtPackageItem.package_id,
        CourtPackage.status.in_(("SUBMITTED", "VERIFIED", "MISMATCH")),
    )


def _grant_allows_read(user: User, resource, resource_type: ResourceType) -> bool:
    from sqlalchemy.orm import object_session

    db = object_session(user)
    if db is None:
        return False
    now = datetime.now(timezone.utc)
    grant = db.scalar(
        select(AccessRequest.id).where(
            AccessRequest.resource_id == resource.id,
            AccessRequest.requester_id == user.id,
            AccessRequest.resource_type == resource_type.value,
            AccessRequest.requested_action == Action.READ.value,
            AccessRequest.status == RequestStatus.APPROVED.value,
            or_(AccessRequest.expires_at.is_(None), AccessRequest.expires_at > now),
        )
    )
    return grant is not None


def _next_number(db: Session, model, case_column, number_column, case_id: uuid.UUID, prefix_code: str) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"{prefix_code}-{year}-"
    numbers = db.scalars(select(number_column).where(case_column == case_id, number_column.like(f"{prefix}%"))).all()
    highest = 0
    for number in numbers:
        suffix = number.removeprefix(prefix)
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"{prefix}{highest + 1:06d}"


def _summary(user: User, evidence: Evidence) -> EvidenceSummary:
    creator = evidence.creator
    return EvidenceSummary(
        id=evidence.id,
        case_id=evidence.case_id,
        evidence_number=evidence.evidence_number,
        title=evidence.title,
        evidence_type=evidence.evidence_type,
        classification=evidence.classification,
        status=evidence.status,
        sha256_hash=evidence.sha256_hash,
        hash_algorithm=evidence.hash_algorithm,
        created_by_name=creator.full_name if creator is not None else "",
        created_at=evidence.created_at,
        allowed_actions=_allowed_actions(user, evidence),
    )


def _detail(db: Session, user: User, evidence: Evidence) -> EvidenceDetail:
    summary = _summary(user, evidence)
    latest = db.scalar(
        select(EvidenceIntegrityEvent.integrity_status)
        .where(EvidenceIntegrityEvent.evidence_id == evidence.id)
        .order_by(EvidenceIntegrityEvent.checked_at.desc())
    )
    custodian = evidence.custodian
    custodian_name = (custodian.full_name or custodian.username) if custodian is not None else None
    return EvidenceDetail(
        **summary.model_dump(),
        description=evidence.description,
        original_filename=evidence.original_filename,
        mime_type=evidence.mime_type,
        file_size=evidence.file_size,
        created_by=evidence.created_by,
        sealed_at=evidence.sealed_at,
        case_number=evidence.case.case_number if evidence.case is not None else "",
        case_title=evidence.case.title if evidence.case is not None else "",
        last_integrity_status=latest,
        custodian_user_id=evidence.custodian_user_id,
        custodian_name=custodian_name,
    )


def _allowed_actions(user: User, evidence: Evidence) -> list[str]:
    actions = []
    case = evidence.case
    if evidence.status == EvidenceStatus.RECEIVED.value and authorize(
        user, Action.VERIFY, ResourceType.EVIDENCE, resource=evidence, case=case
    ).allowed:
        actions.append("VERIFY_STATUS")
    if evidence.status == EvidenceStatus.VERIFIED.value and authorize(
        user, Action.APPROVE, ResourceType.EVIDENCE, resource=evidence, case=case
    ).allowed:
        actions.append("SEAL")
    if evidence.status == EvidenceStatus.SEALED.value and authorize(
        user, Action.APPROVE, ResourceType.EVIDENCE, resource=evidence, case=case
    ).allowed:
        actions.append("ARCHIVE")
    pending = _Pending(case, DocumentClassification(evidence.classification), created_by=user.id)
    if authorize(user, Action.CREATE, ResourceType.DERIVED_ARTIFACT, resource=pending, case=case).allowed or authorize(
        user, Action.UPLOAD, ResourceType.DERIVED_ARTIFACT, resource=pending, case=case
    ).allowed:
        actions.append("CREATE_ARTIFACT")

    is_custodian = getattr(evidence, "custodian_user_id", None) == user.id
    is_supervisor = (
        user.role is not None
        and user.role.name == RoleName.POLICE_SUPERVISOR.value
        and case is not None
        and user.department_id == case.department_id
    )
    if (is_custodian or is_supervisor) and evidence.status != EvidenceStatus.ARCHIVED.value:
        actions.append("TRANSFER")
    return actions


def transfer_evidence(
    db: Session,
    user: User,
    evidence_id: uuid.UUID,
    payload: EvidenceTransfer,
) -> EvidenceDetail:
    evidence = _load_evidence(db, evidence_id)
    _require_visible(user, evidence)
    if evidence.status == EvidenceStatus.ARCHIVED.value:
        raise AppError(403, "forbidden", "Archived evidence cannot be transferred.")

    is_custodian = evidence.custodian_user_id == user.id
    is_supervisor = (
        user.role is not None
        and user.role.name == RoleName.POLICE_SUPERVISOR.value
        and evidence.case is not None
        and user.department_id == evidence.case.department_id
    )
    if not (is_custodian or is_supervisor):
        raise AppError(403, "forbidden", "Only the current custodian or supervisor can transfer evidence custody.")

    recipient = db.get(User, payload.to_user_id)
    if recipient is None or not recipient.is_active:
        raise AppError(422, "validation_error", "Recipient user not found or inactive.")

    prev_custodian = evidence.custodian or db.get(User, evidence.custodian_user_id)
    prev_name = (prev_custodian.full_name or prev_custodian.username) if prev_custodian else "Previous custodian"
    recipient_name = recipient.full_name or recipient.username

    evidence.custodian_user_id = recipient.id
    evidence.custodian = recipient

    from app.services.custody_service import record_event
    record_event(
        db,
        case_id=evidence.case_id,
        evidence_id=evidence.id,
        event_type=CustodyEventType.EVIDENCE_TRANSFERRED,
        performed_by=user.id,
        description=f"Custody transferred from {prev_name} to {recipient_name}. Reason: {payload.reason.strip()}",
        metadata={"from_user_id": str(prev_custodian.id if prev_custodian else ""), "to_user_id": str(recipient.id)},
    )
    db.commit()
    db.refresh(evidence)
    _audit(
        "EVIDENCE_TRANSFERRED",
        user_id=user.id,
        case_id=evidence.case_id,
        evidence_id=evidence.id,
        metadata={
            "from_user_id": str(prev_custodian.id if prev_custodian else ""),
            "to_user_id": str(recipient.id),
            "reason": payload.reason.strip(),
        },
    )
    return _detail(db, user, evidence)


def _artifact_summary(artifact: DerivedArtifact) -> ArtifactSummary:
    creator = artifact.creator
    return ArtifactSummary(
        id=artifact.id,
        case_id=artifact.case_id,
        source_evidence_id=artifact.source_evidence_id,
        source_artifact_id=artifact.source_artifact_id,
        forensic_request_id=artifact.forensic_request_id,
        artifact_number=artifact.artifact_number,
        title=artifact.title,
        description=artifact.description,
        artifact_type=artifact.artifact_type,
        processing_description=artifact.processing_description,
        classification=artifact.classification,
        status=artifact.status,
        original_filename=artifact.original_filename,
        mime_type=artifact.mime_type,
        file_size=artifact.file_size,
        sha256_hash=artifact.sha256_hash,
        hash_algorithm=artifact.hash_algorithm,
        created_by_name=creator.full_name if creator is not None else "",
        created_at=artifact.created_at,
    )


def _tree(rows: list[DerivedArtifact]) -> list[ProvenanceNode]:
    nodes = {
        row.id: ProvenanceNode(
            id=row.id,
            artifact_number=row.artifact_number,
            title=row.title,
            artifact_type=row.artifact_type,
            sha256_hash=row.sha256_hash,
            hash_algorithm=row.hash_algorithm,
            source_artifact_id=row.source_artifact_id,
            created_by_name=row.creator.full_name if row.creator is not None else "",
            created_at=row.created_at,
        )
        for row in rows
    }
    roots: list[ProvenanceNode] = []
    for row in rows:
        node = nodes[row.id]
        parent = nodes.get(row.source_artifact_id) if row.source_artifact_id else None
        if parent is None:
            roots.append(node)
        else:
            parent.children.append(node)
    return roots


class _Pending:
    def __init__(self, case: Case, classification: DocumentClassification, created_by: uuid.UUID) -> None:
        self.id = None
        self.case_id = case.id
        self.case = case
        self.classification = classification.value
        self.created_by = created_by
        self.status = EvidenceStatus.RECEIVED.value


def _index_evidence_quietly(db: Session, evidence: Evidence) -> None:
    try:
        from app.services.indexing_service import index_evidence_record

        index_evidence_record(db, evidence)
    except Exception:
        return


def _index_artifact_quietly(db: Session, artifact: DerivedArtifact) -> None:
    try:
        from app.services.indexing_service import index_artifact_record

        index_artifact_record(db, artifact)
    except Exception:
        return
