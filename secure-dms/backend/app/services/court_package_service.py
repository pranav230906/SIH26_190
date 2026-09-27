"""Court evidence packages. Verification reports a mismatch and does not repair files."""

import hashlib
import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.authorization.permission_service import authorize, enforce, user_has_case_access
from app.constants import Action, CaseEventType, CaseStatus, ResourceType
from app.core.approval_seal import approval_seal
from app.core.exceptions import AppError
from app.core.file_crypto import read_plaintext
from app.models.court_package import CourtPackage, CourtPackageItem
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.evidence import DerivedArtifact, Evidence
from app.models.forensic import ChainOfCustodyEvent
from app.models.user import User
from app.schemas.court_package import CourtPackageCreate, CourtPackageItemRead, CourtPackageRead, CourtPackageVerification
from app.services.audit_service import record as record_audit
from app.services.case_lifecycle import status_label
from app.services.case_service import require_case
from app.services.case_timeline import add_event
from app.services.storage_service import get_storage

def list_packages(db: Session, user: User) -> list[CourtPackageRead]:
    enforce(authorize(user, Action.READ, ResourceType.COURT_PACKAGE))
    rows = db.scalars(
        select(CourtPackage)
        .options(joinedload(CourtPackage.case), joinedload(CourtPackage.items))
        .order_by(CourtPackage.created_at.desc())
    ).unique().all()
    visible = []
    for row in rows:
        if row.case is None or not user_has_case_access(user, row.case):
            continue
        if not authorize(user, Action.READ, ResourceType.COURT_PACKAGE, resource=row, case=row.case).allowed:
            continue
        visible.append(_read(row))
    return visible


def get_package(db: Session, user: User, package_id: uuid.UUID) -> CourtPackageRead:
    package = _load(db, package_id)
    _require(user, package, Action.READ)
    return _read(package)


def create_package(db: Session, user: User, case_key: str, payload: CourtPackageCreate) -> CourtPackageRead:
    case = require_case(db, user, case_key, Action.READ)
    enforce(authorize(user, Action.CREATE, ResourceType.COURT_PACKAGE, case=case), hide_case=True)
    if not payload.document_ids and not payload.evidence_ids and not payload.artifact_ids:
        raise AppError(422, "validation_error", "Select at least one record for the package.")
    items = []
    for document_id in payload.document_ids:
        document = db.get(Document, document_id)
        if document is None or document.case_id != case.id:
            raise AppError(404, "not_found", "Document not found.")
        enforce(authorize(user, Action.READ, ResourceType.DOCUMENT, resource=document, case=case))
        items.append(_document_item(db, document))
    for evidence_id in payload.evidence_ids:
        evidence = db.get(Evidence, evidence_id)
        if evidence is None or evidence.case_id != case.id:
            raise AppError(404, "not_found", "Evidence not found.")
        enforce(authorize(user, Action.READ, ResourceType.EVIDENCE, resource=evidence, case=case))
        items.append(_evidence_item(db, evidence))
    for artifact_id in payload.artifact_ids:
        artifact = db.get(DerivedArtifact, artifact_id)
        if artifact is None or artifact.case_id != case.id:
            raise AppError(404, "not_found", "Evidence not found.")
        enforce(authorize(user, Action.READ, ResourceType.DERIVED_ARTIFACT, resource=artifact, case=case))
        items.append(_artifact_item(artifact))
    package = CourtPackage(
        case_id=case.id,
        package_number=_next_number(db, case.id),
        title=payload.title.strip(),
        status="DRAFT",
        created_by=user.id,
    )
    db.add(package)
    db.flush()
    for item in items:
        item.package_id = package.id
        db.add(item)
    db.commit()
    stored = _load(db, package.id)
    return _read(stored)


def submit_package(db: Session, user: User, package_id: uuid.UUID) -> CourtPackageRead:
    package = _load(db, package_id)
    _require(user, package, Action.CREATE)
    if package.status != "DRAFT":
        raise AppError(409, "conflict", "This package has already been submitted.")
    if package.created_by != user.id:
        raise AppError(403, "forbidden", "You are not authorized to perform this action.")
    now = datetime.now(timezone.utc)
    package.package_hash = _package_hash(package)
    algorithm, value = approval_seal(package.package_hash, str(user.id), now)
    package.seal_algorithm = algorithm
    package.seal_value = value
    package.sealed_by = user.id if value is not None else None
    package.sealed_at = now if value is not None else None
    package.submitted_at = now
    package.status = "SUBMITTED"

    if package.case and package.case.status == CaseStatus.READY_FOR_PROSECUTION.value:
        previous_status = package.case.status
        package.case.status = CaseStatus.IN_COURT.value
        package.case.updated_at = now
        add_event(
            db,
            case_id=package.case.id,
            event_type=CaseEventType.STATUS_CHANGED,
            message=f"Status changed from {status_label(previous_status)} to {status_label(CaseStatus.IN_COURT.value)} via court package submission ({package.package_number}).",
            actor_id=user.id,
        )
        record_audit(
            "CASE_STATUS_CHANGED",
            user_id=user.id,
            case_id=package.case.id,
            metadata={
                "previous_status": previous_status,
                "new_status": CaseStatus.IN_COURT.value,
                "package_number": package.package_number,
            },
        )

    record_audit(
        "COURT_PACKAGE_SUBMITTED",
        user_id=user.id,
        case_id=package.case_id,
        metadata={"package_number": package.package_number, "sealed": value is not None},
    )
    db.commit()
    return _read(_load(db, package.id))


def verify_package(db: Session, user: User, package_id: uuid.UUID) -> CourtPackageVerification:
    package = _load(db, package_id)
    _require(user, package, Action.VERIFY)
    if package.status == "DRAFT":
        raise AppError(409, "conflict", "Submit the package before verification.")
    mismatches = []
    for item in package.items:
        current = _current_hash(db, item)
        if current != item.sha256_hash:
            mismatches.append(item.label)
    package.verification_status = "MISMATCH" if mismatches else "VERIFIED"
    package.verified_at = datetime.now(timezone.utc)
    package.status = package.verification_status
    db.commit()
    return CourtPackageVerification(
        package_id=package.id,
        verification_status=package.verification_status,
        mismatches=mismatches,
    )


def _load(db: Session, package_id: uuid.UUID) -> CourtPackage:
    package = db.scalar(
        select(CourtPackage)
        .options(joinedload(CourtPackage.case), joinedload(CourtPackage.items))
        .where(CourtPackage.id == package_id)
    )
    if package is None or package.case is None:
        raise AppError(404, "not_found", "Court package not found.")
    return package


def _require(user: User, package: CourtPackage, action: Action) -> None:
    if not user_has_case_access(user, package.case):
        raise AppError(404, "not_found", "Court package not found.")
    decision = authorize(user, action, ResourceType.COURT_PACKAGE, resource=package, case=package.case)
    if not decision.allowed:
        if decision.reason in {"CASE_ACCESS_DENIED", "DEPARTMENT_RESTRICTION", "RESOURCE_ACCESS_DENIED", "INVALID_RESOURCE"}:
            raise AppError(404, "not_found", "Court package not found.")
        enforce(decision)


def _document_item(db: Session, document: Document) -> CourtPackageItem:
    versions = db.scalars(select(DocumentVersion).where(DocumentVersion.document_id == document.id)).all()
    approvals = [
        {
            "version": row.version_label,
            "status": row.status,
            "approved_at": row.approved_at.isoformat() if row.approved_at else None,
            "seal_algorithm": row.seal_algorithm,
        }
        for row in versions
    ]
    snapshot = {"kind": "document", "number": document.document_number, "approvals": approvals}
    return CourtPackageItem(
        item_type="DOCUMENT",
        document_id=document.id,
        label=document.document_number,
        sha256_hash=document.file_hash,
        snapshot=json.dumps(snapshot, sort_keys=True),
    )


def _evidence_item(db: Session, evidence: Evidence) -> CourtPackageItem:
    events = db.scalars(
        select(ChainOfCustodyEvent).where(ChainOfCustodyEvent.evidence_id == evidence.id).order_by(ChainOfCustodyEvent.performed_at)
    ).all()
    snapshot = {
        "kind": "evidence",
        "number": evidence.evidence_number,
        "custody": [{"event_type": row.event_type, "performed_at": row.performed_at.isoformat()} for row in events],
        "provenance": evidence.evidence_number,
    }
    return CourtPackageItem(
        item_type="EVIDENCE",
        evidence_id=evidence.id,
        label=evidence.evidence_number,
        sha256_hash=evidence.sha256_hash,
        snapshot=json.dumps(snapshot, sort_keys=True),
    )


def _artifact_item(artifact: DerivedArtifact) -> CourtPackageItem:
    snapshot = {
        "kind": "artifact",
        "number": artifact.artifact_number,
        "source_evidence_id": str(artifact.source_evidence_id),
        "source_artifact_id": str(artifact.source_artifact_id) if artifact.source_artifact_id else None,
    }
    return CourtPackageItem(
        item_type="ARTIFACT",
        artifact_id=artifact.id,
        label=artifact.artifact_number,
        sha256_hash=artifact.sha256_hash,
        snapshot=json.dumps(snapshot, sort_keys=True),
    )


def _current_hash(db: Session, item: CourtPackageItem) -> str | None:
    if item.document_id is not None:
        document = db.get(Document, item.document_id)
        if document is None:
            return None
        return _hash_file(document.storage_path, False)
    if item.evidence_id is not None:
        evidence = db.get(Evidence, item.evidence_id)
        if evidence is None:
            return None
        return _hash_file(evidence.storage_path, evidence.storage_encrypted)
    if item.artifact_id is not None:
        artifact = db.get(DerivedArtifact, item.artifact_id)
        if artifact is None:
            return None
        return _hash_file(artifact.storage_path, artifact.storage_encrypted)
    return None


def _hash_file(relative_path: str, encrypted: bool) -> str | None:
    try:
        blob = get_storage().get_file(relative_path).read_bytes()
        plain = read_plaintext(blob, encrypted)
    except Exception:
        return None
    return hashlib.sha256(plain).hexdigest()


def _package_hash(package: CourtPackage) -> str:
    parts = sorted(f"{item.label}:{item.sha256_hash}:{item.snapshot}" for item in package.items)
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def _next_number(db: Session, case_id: uuid.UUID) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"PKG-{year}-"
    numbers = db.scalars(
        select(CourtPackage.package_number).where(CourtPackage.case_id == case_id, CourtPackage.package_number.like(f"{prefix}%"))
    ).all()
    highest = 0
    for number in numbers:
        suffix = number.removeprefix(prefix)
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"{prefix}{highest + 1:06d}"


def _read(package: CourtPackage) -> CourtPackageRead:
    case = package.case
    return CourtPackageRead(
        id=package.id,
        case_id=package.case_id,
        case_number=case.case_number if case is not None else "",
        package_number=package.package_number,
        title=package.title,
        status=package.status,
        created_by=package.created_by,
        created_at=package.created_at,
        submitted_at=package.submitted_at,
        package_hash=package.package_hash,
        seal_algorithm=package.seal_algorithm,
        seal_value=package.seal_value,
        verification_status=package.verification_status,
        verified_at=package.verified_at,
        items=[
            CourtPackageItemRead(
                id=item.id,
                item_type=item.item_type,
                label=item.label,
                sha256_hash=item.sha256_hash,
                document_id=item.document_id,
                evidence_id=item.evidence_id,
                artifact_id=item.artifact_id,
                snapshot=item.snapshot,
            )
            for item in package.items
        ],
    )
