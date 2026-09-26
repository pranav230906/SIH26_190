"""Case queries. Visibility is applied in the database query, not after the fact."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.authorization.permission_service import authorize, enforce, user_has_case_access
from app.authorization.policies import role_has_system_case_access
from app.constants import Action, CaseEventType, CaseStatus, CaseType, RequestStatus, ResourceType, RoleName
from app.core.exceptions import AppError
from app.models.access_request import AccessRequest
from app.models.case import Case
from app.models.case_assignment import CaseAssignment
from app.models.department import Department
from app.models.user import User
from app.schemas.case import (
    CaseCreate,
    CaseDepartment,
    CaseDetail,
    CaseParticipant,
    CaseSummary,
    CaseTimelineEvent,
    CaseUpdate,
)
from app.services.case_lifecycle import allowed_status_values, assert_initial_status, assert_status_transition, status_label
from app.services.case_timeline import add_event, list_events


def list_cases(
    db: Session,
    user: User,
    *,
    status: CaseStatus | None = None,
    case_type: CaseType | None = None,
    department_id: uuid.UUID | None = None,
    query: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[CaseSummary], int]:
    enforce(authorize(user, Action.READ, ResourceType.CASE))
    filters = _filters(
        user,
        status=status,
        case_type=case_type,
        department_id=department_id,
        query=query,
    )
    total = db.scalar(select(func.count()).select_from(Case).where(*filters)) or 0
    rows = db.scalars(
        select(Case)
        .options(*_summary_options())
        .where(*filters)
        .order_by(Case.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().all()
    return [_to_summary(item) for item in rows], total


def get_case(db: Session, user: User, case_key: str) -> CaseDetail:
    case = resolve_case(db, case_key)
    if case is None or not user_has_case_access(user, case):
        if case is not None:
            _audit("UNAUTHORIZED_CASE_ACCESS_ATTEMPT", user_id=user.id, case_id=case.id)
        raise AppError(404, "not_found", "Case not found.")
    enforce(authorize(user, Action.READ, ResourceType.CASE, case=case), hide_case=True)
    _audit("CASE_ACCESSED", user_id=user.id, case_id=case.id)
    return _to_detail(db, user, case)


def create_case(db: Session, user: User, payload: CaseCreate) -> CaseDetail:
    enforce(authorize(user, Action.CREATE, ResourceType.CASE))
    assert_initial_status(payload.status)
    department_id = payload.department_id or user.department_id
    if db.get(Department, department_id) is None:
        raise AppError(422, "validation_error", "Unknown department.")
    case = Case(
        case_number=payload.case_number,
        title=payload.title.strip(),
        description=payload.description.strip(),
        case_type=payload.case_type.value,
        status=payload.status.value,
        classification=payload.classification.value,
        department_id=department_id,
        created_by=user.id,
    )
    db.add(case)
    db.flush()
    add_event(
        db,
        case_id=case.id,
        event_type=CaseEventType.CASE_CREATED,
        message="Case created.",
        actor_id=user.id,
    )
    if user.role is not None and user.role.name == RoleName.POLICE_SUPERVISOR.value:
        db.add(
            CaseAssignment(
                case_id=case.id,
                user_id=user.id,
                assignment_type="SUPERVISOR",
                assigned_by=user.id,
                active=True,
            )
        )
        add_event(
            db,
            case_id=case.id,
            event_type=CaseEventType.ASSIGNMENT_ADDED,
            message=f"Supervisor assigned: {user.full_name}.",
            actor_id=user.id,
        )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, "conflict", "A case with this case number already exists.") from exc
    stored = resolve_case(db, str(case.id))
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    _audit("CASE_CREATED", user_id=user.id, case_id=stored.id, metadata={"case_number": stored.case_number})
    return _to_detail(db, user, stored)


def update_case(db: Session, user: User, case_key: str, payload: CaseUpdate) -> CaseDetail:
    if (
        payload.title is None
        and payload.description is None
        and payload.status is None
        and payload.classification is None
        and payload.department_id is None
    ):
        raise AppError(422, "validation_error", "Provide at least one field to update.")
    case = resolve_case(db, case_key)
    if case is None or not user_has_case_access(user, case):
        raise AppError(404, "not_found", "Case not found.")
    enforce(authorize(user, Action.UPDATE, ResourceType.CASE, case=case), hide_case=True)
    if payload.title is not None:
        case.title = payload.title.strip()
    if payload.description is not None:
        case.description = payload.description.strip()
    if payload.classification is not None:
        case.classification = payload.classification.value
    if payload.department_id is not None:
        if db.get(Department, payload.department_id) is None:
            raise AppError(422, "validation_error", "Unknown department.")
        case.department_id = payload.department_id
    if payload.status is not None:
        assert_status_transition(case.status, payload.status)
        previous = case.status
        case.status = payload.status.value
        add_event(
            db,
            case_id=case.id,
            event_type=CaseEventType.STATUS_CHANGED,
            message=f"Status changed from {status_label(previous)} to {status_label(payload.status.value)}.",
            actor_id=user.id,
        )
    case.updated_at = datetime.now(timezone.utc)
    db.commit()
    stored = resolve_case(db, str(case.id))
    if stored is None:
        raise AppError(500, "internal_error", "An unexpected error occurred.")
    return _to_detail(db, user, stored)


def resolve_case(db: Session, case_key: str) -> Case | None:
    statement = select(Case).options(*_detail_options())
    try:
        case_id = uuid.UUID(case_key)
    except ValueError:
        case_id = None
    if case_id is not None:
        found = db.scalar(statement.where(Case.id == case_id))
        if found is not None:
            return found
    return db.scalar(statement.where(Case.case_number == case_key))


def require_case(db: Session, user: User, case_key: str, action: Action) -> Case:
    case = resolve_case(db, case_key)
    if case is None or not user_has_case_access(user, case):
        raise AppError(404, "not_found", "Case not found.")
    enforce(authorize(user, action, ResourceType.CASE, case=case), hide_case=True)
    return case


def _filters(
    user: User,
    *,
    status: CaseStatus | None,
    case_type: CaseType | None,
    department_id: uuid.UUID | None,
    query: str | None,
) -> list:
    filters = []
    if not role_has_system_case_access(user.role.name):
        filters.append(_visible_to(user.id))
    if status is not None:
        filters.append(Case.status == status.value)
    if case_type is not None:
        filters.append(Case.case_type == case_type.value)
    if department_id is not None:
        filters.append(Case.department_id == department_id)
    term = (query or "").strip()
    if term:
        pattern = f"%{term}%"
        filters.append(or_(Case.case_number.ilike(pattern), Case.title.ilike(pattern)))
    return filters


def _visible_to(user_id: uuid.UUID):
    now = datetime.now(timezone.utc)
    assigned = exists().where(
        CaseAssignment.case_id == Case.id,
        CaseAssignment.user_id == user_id,
        CaseAssignment.active.is_(True),
    )
    granted = exists().where(
        AccessRequest.case_id == Case.id,
        AccessRequest.requester_id == user_id,
        AccessRequest.status == RequestStatus.APPROVED.value,
        or_(AccessRequest.expires_at.is_(None), AccessRequest.expires_at > now),
    )
    return or_(assigned, granted)


def _summary_options():
    return (
        joinedload(Case.department),
        selectinload(Case.assignments).joinedload(CaseAssignment.user),
    )


def _detail_options():
    return (
        joinedload(Case.department),
        joinedload(Case.creator),
        selectinload(Case.assignments).joinedload(CaseAssignment.user).joinedload(User.role),
        selectinload(Case.assignments).joinedload(CaseAssignment.user).joinedload(User.department),
    )


def _to_summary(case: Case) -> CaseSummary:
    return CaseSummary(
        id=case.id,
        case_number=case.case_number,
        title=case.title,
        case_type=case.case_type,
        status=case.status,
        classification=case.classification,
        department=_department(case),
        primary_officer_name=_primary_officer(case),
        created_at=case.created_at,
        updated_at=case.updated_at,
    )


def _to_detail(db: Session, user: User, case: Case) -> CaseDetail:
    summary = _to_summary(case)
    can_update = authorize(user, Action.UPDATE, ResourceType.CASE, case=case).allowed
    creator = case.creator
    return CaseDetail(
        **summary.model_dump(),
        description=case.description,
        created_by=case.created_by,
        created_by_name=creator.full_name if creator is not None else "",
        participants=[_participant(item) for item in case.assignments if item.active],
        timeline=[
            CaseTimelineEvent(id=event.id, event_type=event.event_type, message=event.message, occurred_at=event.occurred_at)
            for event in list_events(db, case.id)
        ],
        allowed_status_transitions=allowed_status_values(case.status) if can_update else [],
    )


def _department(case: Case) -> CaseDepartment | None:
    department = case.department
    if department is None:
        return None
    return CaseDepartment(id=department.id, name=department.name, code=department.code)


def _audit(event_type: str, **fields) -> None:
    from app.services.audit_service import record

    record(event_type, **fields)


def _primary_officer(case: Case) -> str | None:
    for item in case.assignments:
        if item.active and item.assignment_type == "PRIMARY_OFFICER" and item.user is not None:
            return item.user.full_name
    return None


def _participant(item: CaseAssignment) -> CaseParticipant:
    account = item.user
    role_name = account.role.name if account is not None and account.role is not None else ""
    department = account.department if account is not None else None
    return CaseParticipant(
        assignment_id=item.id,
        user_id=item.user_id,
        full_name=account.full_name if account is not None else "",
        username=account.username if account is not None else "",
        role_name=role_name,
        department_name=department.name if department is not None else "",
        department_code=department.code if department is not None else "",
        assignment_type=item.assignment_type,
        assigned_at=item.assigned_at,
        active=item.active,
    )
