"""Forensic examination requests. Original evidence is never modified here."""

import uuid
from datetime import datetime, timezone

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.authorization.permission_service import authorize, enforce, user_has_case_access
from app.authorization.policies import (
    EXAMINATION_STATUSES,
    FORENSIC_REQUEST_TRANSITIONS,
    REVIEW_VISIBLE_STATUSES,
)
from app.constants import (
    Action,
    ArtifactType,
    CustodyEventType,
    FindingStatus,
    ForensicRequestStatus,
    ForensicRequestType,
    IntegrityStatus,
    ResourceType,
    ReviewDecision,
    RoleName,
)
from app.core.exceptions import AppError
from app.models.case import Case
from app.models.case_assignment import CaseAssignment
from app.models.evidence import DerivedArtifact, Evidence, EvidenceIntegrityEvent
from app.models.forensic import (
    ForensicFinding,
    ForensicFindingArtifact,
    ForensicRequest,
    ForensicRequestEvidence,
    ForensicReview,
)
from app.models.user import User
from app.schemas.evidence import ArtifactSummary
from app.schemas.forensic import (
    EvidenceRef,
    FindingRead,
    ForensicAssign,
    ForensicFindingCreate,
    ForensicReject,
    ForensicRequestCreate,
    ForensicRequestDetail,
    ForensicRequestSummary,
    ForensicReviewCreate,
)
from app.services.case_service import require_case
from app.services.custody_service import record_event
from app.services.evidence_service import (
    _artifact_summary,
    check_evidence_integrity,
    create_artifact_from_evidence,
    get_evidence,
)

INTEGRITY_BLOCKED = "Evidence integrity verification failed. Further forensic processing is blocked."


def list_case_requests(
    db: Session,
    user: User,
    case_key: str,
    *,
    status: ForensicRequestStatus | None = None,
    request_type: ForensicRequestType | None = None,
    assigned_to: uuid.UUID | None = None,
) -> list[ForensicRequestSummary]:
    case = require_case(db, user, case_key, Action.READ)
    enforce(authorize(user, Action.READ, ResourceType.FORENSIC_REPORT, case=case), hide_case=True)
    filters = [ForensicRequest.case_id == case.id, _visibility(user)]
    if status is not None:
        filters.append(ForensicRequest.status == status.value)
    if request_type is not None:
        filters.append(ForensicRequest.request_type == request_type.value)
    if assigned_to is not None:
        filters.append(ForensicRequest.assigned_to == assigned_to)
    rows = _load_many(db, filters)
    return [_summary(user, row) for row in rows]


def create_request(db: Session, user: User, case_key: str, payload: ForensicRequestCreate) -> ForensicRequestDetail:
    case = require_case(db, user, case_key, Action.READ)
    enforce(authorize(user, Action.CREATE, ResourceType.FORENSIC_REPORT, case=case), hide_case=True)
    evidence_rows = _evidence_for_request(db, user, case, payload.evidence_ids)
    purpose = (payload.purpose or payload.instructions).strip()
    request = ForensicRequest(
        case_id=case.id,
        request_number=_next_number(db, case.id),
        requested_by=user.id,
        request_type=payload.request_type.value,
        reason=payload.reason.strip(),
        instructions=payload.instructions.strip(),
        status=ForensicRequestStatus.DRAFT.value,
        created_by=user.id,
    )
    _move(request, ForensicRequestStatus.SUBMITTED)
    _move(request, ForensicRequestStatus.PENDING_APPROVAL)
    db.add(request)
    db.flush()
    for evidence in evidence_rows:
        db.add(
            ForensicRequestEvidence(
                request_id=request.id,
                evidence_id=evidence.id,
                purpose=purpose,
            )
        )
        record_event(
            db,
            case_id=case.id,
            evidence_id=evidence.id,
            request_id=request.id,
            event_type=CustodyEventType.FORENSIC_REQUEST_CREATED,
            performed_by=user.id,
            description=f"Forensic examination requested ({request.request_number}).",
        )
    db.commit()
    stored = _load(db, request.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(user, stored)


def get_request(db: Session, user: User, request_id: uuid.UUID) -> ForensicRequestDetail:
    request = _require(db, user, request_id)
    return _detail(user, request)


def approve_request(db: Session, user: User, request_id: uuid.UUID) -> ForensicRequestDetail:
    request = _require(db, user, request_id)
    _move(request, ForensicRequestStatus.APPROVED)
    enforce(authorize(user, Action.APPROVE, ResourceType.FORENSIC_REPORT, resource=request, case=_case(request)))
    now = datetime.now(timezone.utc)
    request.approved_by = user.id
    request.approved_at = now
    request.updated_at = now
    for link in request.evidence_links:
        record_event(
            db,
            case_id=request.case_id,
            evidence_id=link.evidence_id,
            request_id=request.id,
            event_type=CustodyEventType.FORENSIC_REQUEST_APPROVED,
            performed_by=user.id,
            description=f"Forensic request {request.request_number} approved.",
        )
    db.commit()
    stored = _load(db, request.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(user, stored)


def reject_request(db: Session, user: User, request_id: uuid.UUID, payload: ForensicReject) -> ForensicRequestDetail:
    request = _require(db, user, request_id)
    _move(request, ForensicRequestStatus.REJECTED)
    enforce(authorize(user, Action.REJECT, ResourceType.FORENSIC_REPORT, resource=request, case=_case(request)))
    now = datetime.now(timezone.utc)
    request.rejected_by = user.id
    request.rejected_at = now
    request.rejection_reason = payload.reason.strip()
    request.updated_at = now
    db.commit()
    stored = _load(db, request.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(user, stored)


def assign_request(db: Session, user: User, request_id: uuid.UUID, payload: ForensicAssign) -> ForensicRequestDetail:
    request = _require(db, user, request_id)
    if payload.examiner_id == user.id:
        raise AppError(403, "forbidden", "You cannot assign this request to yourself.")
    _move(request, ForensicRequestStatus.ASSIGNED)
    enforce(authorize(user, Action.ASSIGN, ResourceType.FORENSIC_REPORT, resource=request, case=_case(request)))
    examiner = db.get(User, payload.examiner_id)
    if examiner is None or examiner.role is None or examiner.role.name != RoleName.FORENSIC_EXAMINER.value or not examiner.is_active:
        raise AppError(403, "forbidden", "You are not authorized to perform this action.")
    assigned = db.scalar(
        select(CaseAssignment.id).where(
            CaseAssignment.case_id == request.case_id,
            CaseAssignment.user_id == examiner.id,
            CaseAssignment.active.is_(True),
        )
    )
    if assigned is None:
        raise AppError(403, "forbidden", "That examiner is not assigned to this case.")
    now = datetime.now(timezone.utc)
    request.assigned_to = examiner.id
    request.assigned_by = user.id
    request.assigned_at = now
    request.updated_at = now
    for link in request.evidence_links:
        record_event(
            db,
            case_id=request.case_id,
            evidence_id=link.evidence_id,
            request_id=request.id,
            event_type=CustodyEventType.FORENSIC_REQUEST_ASSIGNED,
            performed_by=user.id,
            description=f"Forensic request {request.request_number} assigned to {examiner.full_name}.",
        )
    db.commit()
    stored = _load(db, request.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(user, stored)


def work_queue(db: Session, user: User) -> list[ForensicRequestSummary]:
    enforce(authorize(user, Action.READ, ResourceType.FORENSIC_REPORT))
    rows = _load_many(db, [ForensicRequest.assigned_to == user.id])
    return [_summary(user, row) for row in rows if user_has_case_access(user, _case(row))]


def review_queue(db: Session, user: User) -> list[ForensicRequestSummary]:
    _require_reviewer(user)
    enforce(authorize(user, Action.REVIEW, ResourceType.FORENSIC_REPORT))
    rows = _load_many(db, [ForensicRequest.status == ForensicRequestStatus.SUBMITTED_FOR_REVIEW.value])
    visible = []
    for row in rows:
        if row.assigned_to == user.id or row.requested_by == user.id:
            continue
        if user_has_case_access(user, _case(row)):
            visible.append(_summary(user, row))
    return visible


def start_request(db: Session, user: User, request_id: uuid.UUID) -> ForensicRequestDetail:
    request = _require_examiner(db, user, request_id)
    _ensure_transition(request, ForensicRequestStatus.IN_PROGRESS)
    enforce(authorize(user, Action.UPDATE, ResourceType.FORENSIC_REPORT, resource=request, case=_case(request)))
    _assert_sources_intact(db, user, request)
    _move(request, ForensicRequestStatus.IN_PROGRESS)
    now = datetime.now(timezone.utc)
    request.started_by = user.id
    request.started_at = now
    request.updated_at = now
    for link in request.evidence_links:
        record_event(
            db,
            case_id=request.case_id,
            evidence_id=link.evidence_id,
            request_id=request.id,
            event_type=CustodyEventType.FORENSIC_ANALYSIS_STARTED,
            performed_by=user.id,
            description=f"Forensic analysis started for {request.request_number}.",
        )
    db.commit()
    stored = _load(db, request.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(user, stored)


def open_requested_evidence(db: Session, user: User, request_id: uuid.UUID, evidence_id: uuid.UUID):
    request = _require(db, user, request_id)
    _require_request_evidence_context(user, request, evidence_id)
    evidence = _linked_evidence(request, evidence_id)
    record_event(
        db,
        case_id=request.case_id,
        evidence_id=evidence.id,
        request_id=request.id,
        event_type=CustodyEventType.EVIDENCE_ACCESSED,
        performed_by=user.id,
        description=f"Evidence opened through forensic request {request.request_number}.",
    )
    db.commit()
    return get_evidence(db, user, evidence.id)


def create_request_artifact(
    db: Session,
    user: User,
    request_id: uuid.UUID,
    upload: UploadFile,
    *,
    evidence_id: uuid.UUID,
    title: str,
    artifact_type: ArtifactType,
    processing_description: str,
    description: str | None,
) -> ArtifactSummary:
    request = _require_examiner(db, user, request_id)
    if request.status != ForensicRequestStatus.IN_PROGRESS.value:
        raise AppError(422, "validation_error", "Start the examination before creating an artifact.")
    _linked_evidence(request, evidence_id)
    _assert_sources_intact(db, user, request)
    artifact = create_artifact_from_evidence(
        db,
        user,
        evidence_id,
        upload,
        title=title,
        artifact_type=artifact_type,
        processing_description=processing_description,
        description=description,
        forensic_request_id=request.id,
        integrity_message=INTEGRITY_BLOCKED,
    )
    return artifact


def add_finding(db: Session, user: User, request_id: uuid.UUID, payload: ForensicFindingCreate) -> ForensicRequestDetail:
    request = _require_examiner(db, user, request_id)
    if request.status != ForensicRequestStatus.IN_PROGRESS.value:
        raise AppError(422, "validation_error", "Findings can be added while the examination is in progress.")
    enforce(authorize(user, Action.UPDATE, ResourceType.FORENSIC_REPORT, resource=request, case=_case(request)))
    artifacts = _artifacts_for_finding(db, request, payload.artifact_ids)
    finding = ForensicFinding(
        request_id=request.id,
        finding_number=_next_finding_number(db, request.id),
        title=payload.title.strip(),
        description=payload.description.strip(),
        finding_type=payload.finding_type.value,
        status=FindingStatus.RECORDED.value,
        created_by=user.id,
    )
    db.add(finding)
    db.flush()
    for artifact in artifacts:
        db.add(ForensicFindingArtifact(finding_id=finding.id, artifact_id=artifact.id))
    request.updated_at = datetime.now(timezone.utc)
    db.commit()
    stored = _load(db, request.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(user, stored)


def submit_review(db: Session, user: User, request_id: uuid.UUID) -> ForensicRequestDetail:
    request = _require_examiner(db, user, request_id)
    _ensure_transition(request, ForensicRequestStatus.SUBMITTED_FOR_REVIEW)
    enforce(authorize(user, Action.UPDATE, ResourceType.FORENSIC_REPORT, resource=request, case=_case(request)))
    if not request.findings:
        raise AppError(422, "validation_error", "Add at least one finding before submitting for review.")
    _assert_request_provenance(db, request)
    _assert_sources_intact(db, user, request)
    _move(request, ForensicRequestStatus.SUBMITTED_FOR_REVIEW)
    now = datetime.now(timezone.utc)
    request.submitted_by = user.id
    request.submitted_at = now
    request.updated_at = now
    for link in request.evidence_links:
        record_event(
            db,
            case_id=request.case_id,
            evidence_id=link.evidence_id,
            request_id=request.id,
            event_type=CustodyEventType.FORENSIC_REVIEW_SUBMITTED,
            performed_by=user.id,
            description=f"Forensic request {request.request_number} submitted for review.",
        )
    db.commit()
    stored = _load(db, request.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(user, stored)


def review_request(db: Session, user: User, request_id: uuid.UUID, payload: ForensicReviewCreate) -> ForensicRequestDetail:
    request = _require(db, user, request_id)
    _require_reviewer(user)
    if payload.decision == ReviewDecision.RETURN and (payload.comment is None or len(payload.comment.strip()) < 10):
        raise AppError(422, "validation_error", "A comment is required when returning forensic work.")
    target = ForensicRequestStatus.COMPLETED if payload.decision == ReviewDecision.ACCEPT else ForensicRequestStatus.IN_PROGRESS
    _ensure_transition(request, target)
    action = Action.APPROVE if payload.decision == ReviewDecision.ACCEPT else Action.REJECT
    enforce(authorize(user, action, ResourceType.FORENSIC_REPORT, resource=request, case=_case(request)))
    if payload.decision == ReviewDecision.ACCEPT:
        _assert_request_provenance(db, request)
        _assert_sources_intact(db, user, request)
    _move(request, target)
    now = datetime.now(timezone.utc)
    comment = payload.comment.strip() if payload.comment else None
    db.add(
        ForensicReview(
            request_id=request.id,
            decision=payload.decision.value,
            comment=comment,
            reviewed_by=user.id,
            reviewed_at=now,
        )
    )
    request.reviewed_by = user.id
    request.reviewed_at = now
    request.review_comment = comment
    request.updated_at = now
    event_type = CustodyEventType.FORENSIC_REVIEW_ACCEPTED
    description = f"Forensic review accepted for {request.request_number}."
    if payload.decision == ReviewDecision.ACCEPT:
        request.completed_at = now
        for finding in request.findings:
            finding.status = FindingStatus.ACCEPTED.value
    else:
        event_type = CustodyEventType.FORENSIC_REVIEW_RETURNED
        description = f"Forensic review returned for {request.request_number}."
        request.submitted_by = None
        request.submitted_at = None
    for link in request.evidence_links:
        record_event(
            db,
            case_id=request.case_id,
            evidence_id=link.evidence_id,
            request_id=request.id,
            event_type=event_type,
            performed_by=user.id,
            description=description,
        )
    db.commit()
    stored = _load(db, request.id)
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _detail(user, stored)


def _evidence_for_request(db: Session, user: User, case: Case, evidence_ids: list[uuid.UUID]) -> list[Evidence]:
    unique_ids = list(dict.fromkeys(evidence_ids))
    rows = db.scalars(select(Evidence).options(joinedload(Evidence.case)).where(Evidence.id.in_(unique_ids))).unique().all()
    found = {row.id: row for row in rows}
    if len(found) != len(unique_ids):
        raise AppError(404, "not_found", "Evidence not found.")
    selected = []
    for evidence_id in unique_ids:
        evidence = found[evidence_id]
        if evidence.case_id != case.id:
            raise AppError(403, "forbidden", "Evidence from another case cannot be added to this request.")
        if not authorize(user, Action.READ, ResourceType.EVIDENCE, resource=evidence, case=case).allowed:
            raise AppError(404, "not_found", "Evidence not found.")
        selected.append(evidence)
    return selected


def _require_request_evidence_context(user: User, request: ForensicRequest, evidence_id: uuid.UUID) -> None:
    role_name = user.role.name if user.role is not None else None
    examiner_ok = user.id == request.assigned_to and request.status in EXAMINATION_STATUSES
    reviewer_ok = role_name == RoleName.FORENSIC_REVIEWER.value and request.status in REVIEW_VISIBLE_STATUSES
    if not examiner_ok and not reviewer_ok:
        raise AppError(403, "forbidden", "You are not authorized to perform this action.")
    _linked_evidence(request, evidence_id)


def _linked_evidence(request: ForensicRequest, evidence_id: uuid.UUID) -> Evidence:
    for link in request.evidence_links:
        evidence = getattr(link, "evidence", None)
        if link.evidence_id == evidence_id and evidence is not None and evidence.case_id == request.case_id:
            return evidence
    raise AppError(404, "not_found", "That evidence is not part of this forensic request.")


def _artifacts_for_finding(db: Session, request: ForensicRequest, artifact_ids: list[uuid.UUID]) -> list[DerivedArtifact]:
    if not artifact_ids:
        return []
    rows = db.scalars(select(DerivedArtifact).where(DerivedArtifact.id.in_(artifact_ids))).all()
    found = {row.id: row for row in rows}
    if len(found) != len(set(artifact_ids)):
        raise AppError(404, "not_found", "Derived artifact not found.")
    linked_evidence = {link.evidence_id for link in request.evidence_links}
    selected = []
    for artifact_id in artifact_ids:
        artifact = found[artifact_id]
        if artifact.case_id != request.case_id or artifact.forensic_request_id != request.id:
            raise AppError(422, "validation_error", "A finding can only cite an artifact produced for this request.")
        if artifact.source_evidence_id not in linked_evidence:
            raise AppError(422, "validation_error", "The artifact does not come from the requested evidence.")
        selected.append(artifact)
    return selected


def _assert_request_provenance(db: Session, request: ForensicRequest) -> None:
    artifacts = db.scalars(select(DerivedArtifact).where(DerivedArtifact.forensic_request_id == request.id)).all()
    if not artifacts:
        raise AppError(422, "validation_error", "Create a derived artifact before submitting for review.")
    linked = {link.evidence_id for link in request.evidence_links}
    for artifact in artifacts:
        if artifact.case_id != request.case_id or artifact.source_evidence_id not in linked:
            raise AppError(422, "validation_error", "An artifact on this request does not trace to the requested evidence.")
        if not artifact.sha256_hash or not artifact.processing_description:
            raise AppError(422, "validation_error", "An artifact is missing provenance details.")


def _assert_sources_intact(db: Session, user: User, request: ForensicRequest) -> None:
    for link in request.evidence_links:
        result = check_evidence_integrity(db, user, link.evidence_id)
        if result.integrity_status != IntegrityStatus.VERIFIED.value:
            raise AppError(409, "conflict", INTEGRITY_BLOCKED)


def _require_examiner(db: Session, user: User, request_id: uuid.UUID) -> ForensicRequest:
    request = _require(db, user, request_id)
    if request.assigned_to != user.id:
        raise AppError(403, "forbidden", "You are not authorized to perform this action.")
    role_name = user.role.name if user.role is not None else None
    if role_name != RoleName.FORENSIC_EXAMINER.value:
        raise AppError(403, "forbidden", "You are not authorized to perform this action.")
    return request


def _require_reviewer(user: User) -> None:
    role_name = user.role.name if user.role is not None else None
    if role_name not in {RoleName.FORENSIC_REVIEWER.value, RoleName.ADMIN.value}:
        raise AppError(403, "forbidden", "You are not authorized to perform this action.")


def _ensure_transition(request: ForensicRequest, target: ForensicRequestStatus) -> None:
    allowed = FORENSIC_REQUEST_TRANSITIONS.get(request.status, frozenset())
    if target.value not in allowed:
        raise AppError(422, "validation_error", "That status change is not allowed.")


def _move(request: ForensicRequest, target: ForensicRequestStatus) -> None:
    _ensure_transition(request, target)
    request.status = target.value


def _visibility(user: User):
    role_name = user.role.name if user.role is not None else None
    if role_name == RoleName.FORENSIC_EXAMINER.value:
        return ForensicRequest.assigned_to == user.id
    if role_name == RoleName.POLICE_OFFICER.value:
        return ForensicRequest.requested_by == user.id
    if role_name == RoleName.FORENSIC_REVIEWER.value:
        return ForensicRequest.status.in_(tuple(REVIEW_VISIBLE_STATUSES))
    return ForensicRequest.case_id.is_not(None)


def _require(db: Session, user: User, request_id: uuid.UUID) -> ForensicRequest:
    request = _load(db, request_id)
    if request is None or not user_has_case_access(user, _case(request)):
        raise AppError(404, "not_found", "Forensic request not found.")
    if not _can_see(user, request):
        raise AppError(404, "not_found", "Forensic request not found.")
    enforce(authorize(user, Action.READ, ResourceType.FORENSIC_REPORT, resource=request, case=_case(request)))
    return request


def _can_see(user: User, request: ForensicRequest) -> bool:
    role_name = user.role.name if user.role is not None else None
    if role_name == RoleName.FORENSIC_EXAMINER.value:
        return request.assigned_to == user.id
    if role_name == RoleName.POLICE_OFFICER.value:
        return request.requested_by == user.id
    if role_name == RoleName.FORENSIC_REVIEWER.value:
        return request.status in REVIEW_VISIBLE_STATUSES
    return True


def _load(db: Session, request_id: uuid.UUID) -> ForensicRequest | None:
    return db.scalar(
        select(ForensicRequest)
        .options(
            joinedload(ForensicRequest.evidence_links).joinedload(ForensicRequestEvidence.evidence),
            joinedload(ForensicRequest.findings).joinedload(ForensicFinding.artifact_links),
        )
        .where(ForensicRequest.id == request_id)
    )


def _load_many(db: Session, filters: list) -> list[ForensicRequest]:
    return db.scalars(
        select(ForensicRequest)
        .options(joinedload(ForensicRequest.evidence_links))
        .where(*filters)
        .order_by(ForensicRequest.created_at.desc())
    ).unique().all()


def _case(request: ForensicRequest) -> Case:
    case = db_case(request)
    if case is None:
        raise AppError(404, "not_found", "Forensic request not found.")
    return case


def db_case(request: ForensicRequest) -> Case | None:
    from sqlalchemy.orm import object_session

    session = object_session(request)
    if session is None:
        return None
    return session.get(Case, request.case_id)


def _summary(user: User, request: ForensicRequest) -> ForensicRequestSummary:
    case = db_case(request)
    requester = _user(request, request.requested_by)
    examiner = _user(request, request.assigned_to)
    return ForensicRequestSummary(
        id=request.id,
        case_id=request.case_id,
        case_number=case.case_number if case is not None else "",
        request_number=request.request_number,
        request_type=request.request_type,
        status=request.status,
        requested_by_name=requester.full_name if requester is not None else "",
        assigned_to_name=examiner.full_name if examiner is not None else None,
        evidence_count=len(request.evidence_links),
        requested_at=request.requested_at,
        created_at=request.created_at,
        allowed_actions=_actions(user, request),
    )


def _detail(user: User, request: ForensicRequest) -> ForensicRequestDetail:
    summary = _summary(user, request)
    case = db_case(request)
    approver = _user(request, request.approved_by)
    reviewer = _user(request, request.reviewed_by)
    return ForensicRequestDetail(
        **summary.model_dump(),
        case_title=case.title if case is not None else "",
        reason=request.reason,
        instructions=request.instructions,
        requested_by=request.requested_by,
        assigned_to=request.assigned_to,
        approved_by_name=approver.full_name if approver is not None else None,
        approved_at=request.approved_at,
        rejection_reason=request.rejection_reason,
        rejected_at=request.rejected_at,
        started_at=request.started_at,
        submitted_at=request.submitted_at,
        reviewed_by_name=reviewer.full_name if reviewer is not None else None,
        reviewed_at=request.reviewed_at,
        review_comment=request.review_comment,
        completed_at=request.completed_at,
        evidence=[_evidence_ref(link) for link in request.evidence_links if getattr(link, "evidence", None) is not None],
        findings=[_finding(request, finding) for finding in request.findings],
        artifacts=_request_artifacts(request),
    )


def _evidence_ref(link: ForensicRequestEvidence) -> EvidenceRef:
    evidence = link.evidence
    return EvidenceRef(
        id=evidence.id,
        evidence_number=evidence.evidence_number,
        title=evidence.title,
        evidence_type=evidence.evidence_type,
        classification=evidence.classification,
        status=evidence.status,
        sha256_hash=evidence.sha256_hash,
        purpose=link.purpose,
        integrity_status=_latest_integrity(link),
    )


def _finding(request: ForensicRequest, finding: ForensicFinding) -> FindingRead:
    creator = _user(request, finding.created_by)
    numbers = []
    ids = []
    session_artifacts = {link.artifact_id: link for link in finding.artifact_links}
    from sqlalchemy.orm import object_session

    session = object_session(request)
    for artifact_id in session_artifacts:
        ids.append(artifact_id)
        if session is not None:
            artifact = session.get(DerivedArtifact, artifact_id)
            if artifact is not None:
                numbers.append(artifact.artifact_number)
    return FindingRead(
        id=finding.id,
        finding_number=finding.finding_number,
        title=finding.title,
        description=finding.description,
        finding_type=finding.finding_type,
        status=finding.status,
        created_by_name=creator.full_name if creator is not None else "",
        created_at=finding.created_at,
        artifact_ids=ids,
        artifact_numbers=numbers,
    )


def _actions(user: User, request: ForensicRequest) -> list[str]:
    actions = ["OPEN"]
    case = db_case(request)
    if case is None:
        return actions
    if request.status == ForensicRequestStatus.PENDING_APPROVAL.value and authorize(
        user, Action.APPROVE, ResourceType.FORENSIC_REPORT, resource=request, case=case
    ).allowed:
        actions.append("APPROVE")
    if request.status == ForensicRequestStatus.PENDING_APPROVAL.value and authorize(
        user, Action.REJECT, ResourceType.FORENSIC_REPORT, resource=request, case=case
    ).allowed:
        actions.append("REJECT")
    if request.status == ForensicRequestStatus.APPROVED.value and authorize(
        user, Action.ASSIGN, ResourceType.FORENSIC_REPORT, resource=request, case=case
    ).allowed:
        actions.append("ASSIGN")
    if request.assigned_to == user.id and request.status == ForensicRequestStatus.ASSIGNED.value:
        actions.append("START")
    if request.assigned_to == user.id and request.status == ForensicRequestStatus.IN_PROGRESS.value:
        actions.extend(["CREATE_ARTIFACT", "ADD_FINDING", "SUBMIT_REVIEW"])
    role_name = user.role.name if user.role is not None else None
    if (
        request.status == ForensicRequestStatus.SUBMITTED_FOR_REVIEW.value
        and role_name in {RoleName.FORENSIC_REVIEWER.value, RoleName.ADMIN.value}
        and request.assigned_to != user.id
        and request.requested_by != user.id
    ):
        actions.append("REVIEW")
    return actions


def _user(request: ForensicRequest, user_id: uuid.UUID | None) -> User | None:
    if user_id is None:
        return None
    from sqlalchemy.orm import object_session

    session = object_session(request)
    if session is None:
        return None
    return session.get(User, user_id)


def _request_artifacts(request: ForensicRequest) -> list[ArtifactSummary]:
    from sqlalchemy.orm import object_session

    session = object_session(request)
    if session is None:
        return []
    rows = session.scalars(
        select(DerivedArtifact)
        .options(joinedload(DerivedArtifact.creator))
        .where(DerivedArtifact.forensic_request_id == request.id)
        .order_by(DerivedArtifact.created_at.asc())
    ).unique().all()
    return [_artifact_summary(row) for row in rows]


def _latest_integrity(link: ForensicRequestEvidence) -> str | None:
    from sqlalchemy.orm import object_session

    session = object_session(link)
    if session is None:
        return None
    return session.scalar(
        select(EvidenceIntegrityEvent.integrity_status)
        .where(EvidenceIntegrityEvent.evidence_id == link.evidence_id)
        .order_by(EvidenceIntegrityEvent.checked_at.desc())
    )


def _next_number(db: Session, case_id: uuid.UUID) -> str:
    del case_id
    year = datetime.now(timezone.utc).year
    prefix = f"FR-{year}-"
    numbers = db.scalars(select(ForensicRequest.request_number).where(ForensicRequest.request_number.like(f"{prefix}%"))).all()
    highest = 0
    for number in numbers:
        suffix = number.removeprefix(prefix)
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    return f"{prefix}{highest + 1:06d}"


def _next_finding_number(db: Session, request_id: uuid.UUID) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"FIND-{year}-"
    count = db.scalar(select(func.count()).select_from(ForensicFinding).where(ForensicFinding.request_id == request_id)) or 0
    return f"{prefix}{count + 1:06d}"
