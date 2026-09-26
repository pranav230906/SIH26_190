"""Case assignment changes. Callers cannot grant themselves access."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.authorization.permission_service import authorize, enforce
from app.authorization.policies import assignment_matches_role
from app.constants import Action, CaseEventType, ResourceType
from app.core.exceptions import AppError
from app.models.case_assignment import CaseAssignment
from app.models.user import User
from app.services.case_timeline import add_event
from app.schemas.authorization import AssignmentCreate, AssignmentRead
from app.services.case_service import require_case


def list_assignments(db: Session, user: User, case_key: str) -> list[AssignmentRead]:
    case = require_case(db, user, case_key, Action.READ)
    rows = db.scalars(
        select(CaseAssignment)
        .options(
            joinedload(CaseAssignment.user).joinedload(User.role),
            joinedload(CaseAssignment.user).joinedload(User.department),
        )
        .where(CaseAssignment.case_id == case.id, CaseAssignment.active.is_(True))
        .order_by(CaseAssignment.assigned_at.asc())
    ).unique().all()
    return [_to_read(row) for row in rows]


def create_assignment(db: Session, actor: User, case_key: str, payload: AssignmentCreate) -> AssignmentRead:
    case = require_case(db, actor, case_key, Action.ASSIGN)
    enforce(authorize(actor, Action.ASSIGN, ResourceType.CASE, case=case), hide_case=True)
    if payload.user_id == actor.id:
        raise AppError(403, "forbidden", "You cannot assign yourself to a case.")

    target = db.scalar(
        select(User)
        .options(joinedload(User.role), joinedload(User.department))
        .where(User.id == payload.user_id)
    )
    if target is None or not target.is_active:
        raise AppError(404, "not_found", "User not found.")
    role_name = target.role.name if target.role is not None else None
    if not assignment_matches_role(payload.assignment_type, role_name):
        raise AppError(403, "forbidden", "You are not authorized to perform this action.")

    existing = db.scalar(
        select(CaseAssignment).where(
            CaseAssignment.case_id == case.id,
            CaseAssignment.user_id == target.id,
            CaseAssignment.assignment_type == payload.assignment_type.value,
        )
    )
    if existing is not None and existing.active:
        raise AppError(409, "conflict", "This assignment already exists.")
    if existing is None:
        existing = CaseAssignment(
            case_id=case.id,
            user_id=target.id,
            assignment_type=payload.assignment_type.value,
            assigned_by=actor.id,
            active=True,
        )
        db.add(existing)
    else:
        existing.active = True
        existing.assigned_by = actor.id
        existing.assigned_at = datetime.now(timezone.utc)
        existing.deactivated_at = None
    add_event(
        db,
        case_id=case.id,
        event_type=CaseEventType.ASSIGNMENT_ADDED,
        message=f"{_assignment_label(payload.assignment_type.value)} assigned: {target.full_name}.",
        actor_id=actor.id,
    )
    db.commit()
    db.refresh(existing)
    existing.user = target
    _audit(
        "CASE_ASSIGNMENT_CHANGED",
        user_id=actor.id,
        case_id=case.id,
        metadata={"action": "assigned", "assignment_type": existing.assignment_type, "target_user_id": str(target.id)},
    )
    return _to_read(existing)


def deactivate_assignment(db: Session, actor: User, case_key: str, assignment_id: uuid.UUID) -> None:
    case = require_case(db, actor, case_key, Action.ASSIGN)
    enforce(authorize(actor, Action.ASSIGN, ResourceType.CASE, case=case), hide_case=True)
    row = db.scalar(
        select(CaseAssignment)
        .options(joinedload(CaseAssignment.user))
        .where(
            CaseAssignment.id == assignment_id,
            CaseAssignment.case_id == case.id,
        )
    )
    if row is None or not row.active:
        raise AppError(404, "not_found", "Assignment not found.")
    if row.user_id == actor.id:
        raise AppError(403, "forbidden", "You cannot change your own case assignment.")
    row.active = False
    row.deactivated_at = datetime.now(timezone.utc)
    person = row.user.full_name if row.user is not None else "User"
    add_event(
        db,
        case_id=case.id,
        event_type=CaseEventType.ASSIGNMENT_REMOVED,
        message=f"Assignment removed: {person} ({_assignment_label(row.assignment_type)}).",
        actor_id=actor.id,
    )
    db.commit()
    _audit(
        "CASE_ASSIGNMENT_CHANGED",
        user_id=actor.id,
        case_id=case.id,
        metadata={"action": "removed", "target_user_id": str(row.user_id)},
    )


def _audit(event_type: str, **fields) -> None:
    from app.services.audit_service import record

    record(event_type, **fields)


def _to_read(row: CaseAssignment) -> AssignmentRead:
    account = row.user
    role_name = account.role.name if account is not None and account.role is not None else ""
    department = account.department if account is not None else None
    return AssignmentRead(
        id=row.id,
        case_id=row.case_id,
        user_id=row.user_id,
        username=account.username if account is not None else "",
        full_name=account.full_name if account is not None else "",
        role_name=role_name,
        department_name=department.name if department is not None else "",
        department_code=department.code if department is not None else "",
        assignment_type=row.assignment_type,
        assigned_by=row.assigned_by,
        assigned_at=row.assigned_at,
        active=row.active,
    )


def _assignment_label(value: str) -> str:
    labels = {
        "PRIMARY_OFFICER": "Primary officer",
        "SUPERVISOR": "Supervisor",
        "FORENSIC_EXAMINER": "Forensic examiner",
        "FORENSIC_REVIEWER": "Forensic reviewer",
        "PROSECUTOR": "Prosecutor",
        "JUDICIAL_ACCESS": "Judicial access",
    }
    return labels.get(value, value)
