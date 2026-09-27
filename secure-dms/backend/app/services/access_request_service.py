"""Access-request foundation. Approval still has to pass authorize()."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import exists, or_, select
from sqlalchemy.orm import Session, aliased, joinedload

from app.authorization.permission_service import authorize, enforce, user_has_case_access
from app.authorization.ownership import FORENSIC, POLICE, approver_roles_for_institution, institution_code_for_type
from app.authorization.policies import EMERGENCY_GRANT_HOURS, GRANT_DAYS, REQUESTABLE_ACTIONS
from app.constants import Action, RequestStatus, ResourceType, RoleName
from app.core.exceptions import AppError
from app.models.access_request import AccessRequest
from app.models.case_assignment import CaseAssignment
from app.models.user import User
from app.schemas.authorization import AccessRequestCreate, AccessRequestRead, AccessRequestReview, CaseAccessRequestCreate
from app.services.case_service import require_case


def create_request(db: Session, user: User, case_key: str, payload: AccessRequestCreate) -> AccessRequestRead:
    case = require_case(db, user, case_key, Action.READ)
    enforce(authorize(user, Action.CREATE, ResourceType.ACCESS_REQUEST, case=case), hide_case=True)
    if payload.requested_action not in REQUESTABLE_ACTIONS:
        raise AppError(422, "validation_error", "That access action cannot be requested.")
    if payload.resource_type == ResourceType.AUDIT_LOG:
        raise AppError(422, "validation_error", "That resource cannot be requested.")
    named_types = {ResourceType.DOCUMENT, ResourceType.EVIDENCE, ResourceType.DERIVED_ARTIFACT}
    if payload.resource_id is not None and payload.resource_type not in named_types:
        raise AppError(422, "validation_error", "A specific record can only be named for a document, evidence item, or derived artifact.")
    if payload.resource_id is not None:
        named = _named_record(db, payload.resource_type, payload.resource_id)
        if named is None or named.case_id != case.id:
            raise AppError(404, "not_found", "The requested record was not found.")
        if payload.requested_action == Action.READ and authorize(
            user, Action.READ, payload.resource_type, resource=named, case=case
        ).allowed:
            raise AppError(409, "conflict", "You already have access to this record.")

    duplicate_filters = [
        AccessRequest.case_id == case.id,
        AccessRequest.requester_id == user.id,
        AccessRequest.resource_type == payload.resource_type.value,
        AccessRequest.requested_action == payload.requested_action.value,
        AccessRequest.status == RequestStatus.PENDING.value,
    ]
    if payload.resource_id is None:
        duplicate_filters.append(AccessRequest.resource_id.is_(None))
    else:
        duplicate_filters.append(AccessRequest.resource_id == payload.resource_id)
    existing = db.scalar(select(AccessRequest).where(*duplicate_filters))
    if existing is not None:
        raise AppError(409, "conflict", "A matching request is already pending.")

    record = AccessRequest(
        case_id=case.id,
        requester_id=user.id,
        resource_type=payload.resource_type.value,
        resource_id=payload.resource_id,
        requested_action=payload.requested_action.value,
        justification=payload.justification.strip(),
        status=RequestStatus.PENDING.value,
        access_kind="EMERGENCY" if payload.emergency else "STANDARD",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    record.case = case
    record.requester = user
    _audit(
        "ACCESS_REQUEST_CREATED",
        user_id=user.id,
        case_id=case.id,
        document_id=payload.resource_id if payload.resource_type == ResourceType.DOCUMENT else None,
        evidence_id=payload.resource_id if payload.resource_type == ResourceType.EVIDENCE else None,
        request_id=record.id,
        metadata={
            "resource_type": payload.resource_type.value,
            "requested_action": payload.requested_action.value,
            "emergency": payload.emergency,
        },
    )
    return _to_read(record)


def create_case_request(db: Session, user: User, payload: CaseAccessRequestCreate) -> AccessRequestRead:
    enforce(authorize(user, Action.CREATE, ResourceType.ACCESS_REQUEST))
    from app.models.case import Case
    from sqlalchemy import text

    case_num = payload.case_number.strip()
    case = db.scalar(select(Case).where(Case.case_number == case_num))
    case_id = None
    if case is not None:
        case_id = case.id
        if user_has_case_access(user, case):
            raise AppError(409, "conflict", "You already have access to this case.")
    else:
        try:
            row = db.execute(
                text("SELECT id, case_number, department_id, status FROM lookup_case_by_number(:num)"),
                {"num": case_num},
            ).first()
            if row is not None:
                case_id = row.id
        except Exception:
            pass

    if case_id is None:
        raise AppError(404, "not_found", "Case not found.")

    duplicate_filters = [
        AccessRequest.case_id == case_id,
        AccessRequest.requester_id == user.id,
        AccessRequest.resource_type == ResourceType.CASE.value,
        AccessRequest.requested_action == Action.READ.value,
        AccessRequest.resource_id.is_(None),
        AccessRequest.status == RequestStatus.PENDING.value,
    ]
    existing = db.scalar(select(AccessRequest).where(*duplicate_filters))
    if existing is not None:
        raise AppError(409, "conflict", "A matching request is already pending.")

    record = AccessRequest(
        case_id=case_id,
        requester_id=user.id,
        resource_type=ResourceType.CASE.value,
        resource_id=None,
        requested_action=Action.READ.value,
        justification=payload.justification.strip(),
        status=RequestStatus.PENDING.value,
        access_kind="EMERGENCY" if payload.emergency else "STANDARD",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    if case is not None:
        record.case = case
    record.requester = user
    record._case_number = case_num
    _audit(
        "ACCESS_REQUEST_CREATED",
        user_id=user.id,
        case_id=case_id,
        request_id=record.id,
        metadata={
            "resource_type": ResourceType.CASE.value,
            "requested_action": Action.READ.value,
            "emergency": payload.emergency,
        },
    )
    return _to_read(record)


def list_case_requests(db: Session, user: User, case_key: str) -> list[AccessRequestRead]:
    case = require_case(db, user, case_key, Action.READ)
    enforce(authorize(user, Action.READ, ResourceType.ACCESS_REQUEST, case=case), hide_case=True)
    statement = (
        select(AccessRequest)
        .options(joinedload(AccessRequest.case), joinedload(AccessRequest.requester))
        .where(AccessRequest.case_id == case.id)
        .order_by(AccessRequest.created_at.desc())
    )
    if not _can_review(user, case):
        statement = statement.where(AccessRequest.requester_id == user.id)
    return [_to_read(row) for row in db.scalars(statement).unique().all()]


def list_my_requests(db: Session, user: User) -> list[AccessRequestRead]:
    enforce(authorize(user, Action.READ, ResourceType.ACCESS_REQUEST))
    rows = db.scalars(
        select(AccessRequest)
        .options(joinedload(AccessRequest.case), joinedload(AccessRequest.requester))
        .where(AccessRequest.requester_id == user.id)
        .order_by(AccessRequest.created_at.desc())
    ).unique().all()
    return [_to_read(row) for row in rows]


def list_pending_reviews(db: Session, user: User) -> list[AccessRequestRead]:
    enforce(authorize(user, Action.APPROVE, ResourceType.ACCESS_REQUEST))
    statement = (
        select(AccessRequest)
        .options(joinedload(AccessRequest.case), joinedload(AccessRequest.requester))
        .where(
            AccessRequest.status == RequestStatus.PENDING.value,
            AccessRequest.requester_id != user.id,
        )
        .order_by(AccessRequest.created_at.desc())
    )
    statement = statement.where(_pending_visible_to(user))
    rows = db.scalars(statement).unique().all()
    return [_to_read(row) for row in rows if _owns_request(db, user, row)]


def list_active_grants(db: Session, user: User) -> list[AccessRequestRead]:
    enforce(authorize(user, Action.APPROVE, ResourceType.ACCESS_REQUEST))
    now = datetime.now(timezone.utc)
    statement = (
        select(AccessRequest)
        .options(joinedload(AccessRequest.case), joinedload(AccessRequest.requester))
        .where(
            AccessRequest.status == RequestStatus.APPROVED.value,
            or_(AccessRequest.expires_at.is_(None), AccessRequest.expires_at > now),
        )
        .order_by(AccessRequest.reviewed_at.desc())
    )
    statement = statement.where(_pending_visible_to(user))
    rows = db.scalars(statement).unique().all()
    return [_to_read(row) for row in rows if _owns_request(db, user, row)]


def review_request(
    db: Session,
    user: User,
    request_id: uuid.UUID,
    *,
    approve: bool,
    payload: AccessRequestReview,
) -> AccessRequestRead:
    record = db.scalar(
        select(AccessRequest)
        .options(joinedload(AccessRequest.case), joinedload(AccessRequest.requester))
        .where(AccessRequest.id == request_id)
    )
    if record is None or record.case is None or not user_has_case_access(user, record.case):
        raise AppError(404, "not_found", "Access request not found.")
    action = Action.APPROVE if approve else Action.REJECT
    decision = authorize(user, action, ResourceType.ACCESS_REQUEST, resource=record, case=record.case)
    if not decision.allowed:
        if decision.reason in {"CASE_ACCESS_DENIED", "DEPARTMENT_RESTRICTION", "RESOURCE_ACCESS_DENIED"}:
            raise AppError(404, "not_found", "Access request not found.")
        enforce(decision)
    if record.status != RequestStatus.PENDING.value:
        raise AppError(409, "conflict", "This request has already been reviewed.")
    if not _owns_request(db, user, record):
        raise AppError(403, "forbidden", "Only the owning department can review this request.")

    now = datetime.now(timezone.utc)
    record.status = RequestStatus.APPROVED.value if approve else RequestStatus.REJECTED.value
    record.reviewed_by = user.id
    record.reviewed_at = now
    record.review_note = payload.note.strip() if payload.note else None
    if approve and record.access_kind == "EMERGENCY":
        record.expires_at = now + timedelta(hours=EMERGENCY_GRANT_HOURS)
    elif approve:
        record.expires_at = now + timedelta(days=GRANT_DAYS)
    else:
        record.expires_at = None
    db.commit()
    db.refresh(record)
    _audit(
        "ACCESS_REQUEST_APPROVED" if approve else "ACCESS_REQUEST_REJECTED",
        user_id=user.id,
        case_id=record.case_id,
        document_id=record.resource_id if record.resource_type == ResourceType.DOCUMENT.value else None,
        evidence_id=record.resource_id if record.resource_type == ResourceType.EVIDENCE.value else None,
        request_id=record.id,
        metadata={
            "resource_type": record.resource_type,
            "requested_action": record.requested_action,
            "emergency": record.access_kind == "EMERGENCY",
        },
    )
    return _to_read(record)


def revoke_request(
    db: Session,
    user: User,
    request_id: uuid.UUID,
    payload: AccessRequestReview,
) -> AccessRequestRead:
    record = db.scalar(
        select(AccessRequest)
        .options(joinedload(AccessRequest.case), joinedload(AccessRequest.requester))
        .where(AccessRequest.id == request_id)
    )
    if record is None or record.case is None or not user_has_case_access(user, record.case):
        raise AppError(404, "not_found", "Access request not found.")
    decision = authorize(user, Action.REJECT, ResourceType.ACCESS_REQUEST, resource=record, case=record.case)
    if not decision.allowed:
        if decision.reason in {"CASE_ACCESS_DENIED", "DEPARTMENT_RESTRICTION", "RESOURCE_ACCESS_DENIED"}:
            raise AppError(404, "not_found", "Access request not found.")
        enforce(decision)
    if record.status != RequestStatus.APPROVED.value:
        raise AppError(409, "conflict", "Only active approved access grants can be revoked.")
    if not _owns_request(db, user, record):
        raise AppError(403, "forbidden", "Only the owning department can revoke this access grant.")

    now = datetime.now(timezone.utc)
    record.status = RequestStatus.REVOKED.value
    record.expires_at = now
    record.reviewed_by = user.id
    record.reviewed_at = now
    if payload.note:
        record.review_note = payload.note.strip()
    db.commit()
    db.refresh(record)
    _audit(
        "ACCESS_REQUEST_REVOKED",
        user_id=user.id,
        case_id=record.case_id,
        document_id=record.resource_id if record.resource_type == ResourceType.DOCUMENT.value else None,
        evidence_id=record.resource_id if record.resource_type == ResourceType.EVIDENCE.value else None,
        request_id=record.id,
        metadata={
            "resource_type": record.resource_type,
            "requested_action": record.requested_action,
            "revoked": True,
        },
    )
    return _to_read(record)


def _audit(event_type: str, **fields) -> None:
    from app.services.audit_service import record

    record(event_type, **fields)


def _named_record(db: Session, resource_type: ResourceType, resource_id: uuid.UUID):
    if resource_type == ResourceType.DOCUMENT:
        from app.models.document import Document

        return db.get(Document, resource_id)
    if resource_type == ResourceType.EVIDENCE:
        from app.models.evidence import Evidence

        return db.get(Evidence, resource_id)
    if resource_type == ResourceType.DERIVED_ARTIFACT:
        from app.models.evidence import DerivedArtifact

        return db.get(DerivedArtifact, resource_id)
    return None


def _pending_visible_to(user: User):
    now = datetime.now(timezone.utc)
    grant = aliased(AccessRequest)
    assigned = exists().where(
        CaseAssignment.case_id == AccessRequest.case_id,
        CaseAssignment.user_id == user.id,
        CaseAssignment.active.is_(True),
    )
    granted = exists().where(
        grant.case_id == AccessRequest.case_id,
        grant.requester_id == user.id,
        grant.status == RequestStatus.APPROVED.value,
        or_(grant.expires_at.is_(None), grant.expires_at > now),
    )
    from app.models.case import Case

    supervisor_for_case_dept = (
        exists().where(
            Case.id == AccessRequest.case_id,
            Case.department_id == user.department_id,
        )
        if (user.role is not None and user.role.name == RoleName.POLICE_SUPERVISOR.value)
        else False
    )
    return or_(assigned, granted, supervisor_for_case_dept)


def _owns_request(db: Session, user: User, record: AccessRequest) -> bool:
    department_id = _owning_department_id(db, record)
    role_name = user.role.name if user.role is not None else None
    if department_id is None or user.department_id != department_id or role_name is None:
        return False
    from app.models.department import Department

    department = db.get(Department, department_id)
    code = department.code if department is not None else None
    return role_name in approver_roles_for_institution(code)


def _owning_department_id(db: Session, record: AccessRequest):
    if record.resource_type == ResourceType.DOCUMENT.value and record.resource_id is not None:
        from app.models.document import Document

        document = db.get(Document, record.resource_id)
        if document is None:
            return None
        if document.owner_department_id is not None:
            return document.owner_department_id
        code = institution_code_for_type(document.document_type)
        return _department_id_for_code(db, code)
    if record.resource_type in {ResourceType.FORENSIC_REPORT.value, ResourceType.DERIVED_ARTIFACT.value}:
        return _department_id_for_code(db, FORENSIC)
    if record.resource_type == ResourceType.EVIDENCE.value:
        return _department_id_for_code(db, POLICE)
    case = record.case
    return case.department_id if case is not None else None


def _department_id_for_code(db: Session, code: str | None):
    if code is None:
        return None
    from app.models.department import Department

    return db.scalar(select(Department.id).where(Department.code == code))


def _can_review(user: User, case) -> bool:
    return authorize(user, Action.APPROVE, ResourceType.ACCESS_REQUEST, case=case).allowed


def _to_read(record: AccessRequest) -> AccessRequestRead:
    case = record.case
    requester = record.requester
    case_number = case.case_number if case is not None else getattr(record, "_case_number", "")
    return AccessRequestRead(
        id=record.id,
        case_id=record.case_id,
        case_number=case_number,
        requester_id=record.requester_id,
        requester_username=requester.username if requester is not None else "",
        resource_type=record.resource_type,
        resource_id=record.resource_id,
        requested_action=record.requested_action,
        justification=record.justification,
        status=RequestStatus(record.status),
        reviewed_by=record.reviewed_by,
        reviewed_at=record.reviewed_at,
        review_note=record.review_note,
        expires_at=record.expires_at,
        created_at=record.created_at,
        access_kind=record.access_kind,
    )
