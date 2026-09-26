"""Authorization decisions. Role names and permission rows come from the database."""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, object_session

from app.authorization.permissions import permission_code
from app.authorization.policies import (
    CASE_SCOPED_RESOURCES,
    ELEVATED_DOCUMENT_CLASSIFICATIONS,
    EXAMINATION_STATUSES,
    IMMUTABLE_DOCUMENT_STATUSES,
    JUDICIAL_ACTIONS,
    MUTATING_ACTIONS,
    REVIEW_ACTIONS,
    REVIEW_VISIBLE_STATUSES,
    is_self_review,
    requires_case_context,
    role_has_system_case_access,
)
from app.constants import Action, CaseStatus, DecisionReason, DocumentStatus, RequestStatus, ResourceType, RoleName
from app.core.exceptions import AppError
from app.models.access_request import AccessRequest
from app.models.case_assignment import CaseAssignment
from app.models.permission import Permission, RolePermission

logger = logging.getLogger("secure_dms.authorization")

SAFE_FORBIDDEN = "You are not authorized to perform this action."
SAFE_CASE_HIDDEN = "Case not found."
SAFE_UNAUTHENTICATED = "Authentication failed."


@dataclass(frozen=True)
class AuthorizationDecision:
    allowed: bool
    reason: str


def authorize(user, action, resource_type, resource=None, case=None) -> AuthorizationDecision:
    if user is None:
        return _deny(DecisionReason.NOT_AUTHENTICATED)
    if not getattr(user, "is_active", False):
        return _deny(DecisionReason.USER_INACTIVE)

    role = getattr(user, "role", None)
    role_name = getattr(role, "name", None)
    if not role_name or getattr(role, "id", None) is None:
        return _deny(DecisionReason.INSUFFICIENT_ROLE)

    action = _as_action(action)
    resource_type = _as_resource(resource_type)
    if action is None or resource_type is None:
        return _deny(DecisionReason.INVALID_RESOURCE)

    if case is None and resource is not None:
        case = getattr(resource, "case", None)

    if action in REVIEW_ACTIONS and is_self_review(user, resource):
        return _deny(DecisionReason.ACTION_NOT_ALLOWED)

    if not _role_has_permission(user, resource_type, action):
        return _deny(DecisionReason.MISSING_PERMISSION)

    if role_name == RoleName.JUDICIAL_USER.value and action not in JUDICIAL_ACTIONS:
        return _deny(DecisionReason.ACTION_NOT_ALLOWED)

    if requires_case_context(resource_type, action, case):
        if case is None:
            return _deny(DecisionReason.INVALID_RESOURCE)
        if not user_has_case_access(user, case):
            if _department_blocks(user, case, role_name):
                return _deny(DecisionReason.DEPARTMENT_RESTRICTION)
            return _deny(DecisionReason.CASE_ACCESS_DENIED)

    if case is not None and getattr(case, "status", None) == CaseStatus.ARCHIVED.value:
        if action in MUTATING_ACTIONS and not role_has_system_case_access(role_name):
            return _deny(DecisionReason.ACTION_NOT_ALLOWED)

    if resource_type in CASE_SCOPED_RESOURCES and resource is not None and case is not None:
        resource_case_id = getattr(resource, "case_id", None)
        if resource_case_id is not None and resource_case_id != case.id:
            return _deny(DecisionReason.RESOURCE_ACCESS_DENIED)

    if resource_type == ResourceType.DOCUMENT and resource is not None:
        document_decision = _document_policy(user, action, resource, role_name)
        if document_decision is not None:
            return document_decision

    if resource_type in {ResourceType.EVIDENCE, ResourceType.DERIVED_ARTIFACT} and resource is not None:
        custody_decision = _custody_policy(user, action, resource, role_name, resource_type)
        if custody_decision is not None:
            return custody_decision

    return AuthorizationDecision(True, DecisionReason.ALLOW.value)


def user_has_case_access(user, case) -> bool:
    if user is None or case is None or not getattr(user, "is_active", False):
        return False
    role_name = getattr(getattr(user, "role", None), "name", None)
    if role_has_system_case_access(role_name) and _role_has_permission(user, ResourceType.CASE, Action.READ):
        return True

    assignments = getattr(case, "assignments", None) or []
    if any(item.user_id == user.id and item.active for item in assignments):
        return True

    db = object_session(user)
    if db is None:
        return False
    assigned = db.scalar(
        select(CaseAssignment.id).where(
            CaseAssignment.case_id == case.id,
            CaseAssignment.user_id == user.id,
            CaseAssignment.active.is_(True),
        )
    )
    if assigned is not None:
        return True
    return _has_active_grant(db, user.id, case.id)


def effective_permission_codes(user) -> list[str]:
    db = object_session(user) if user is not None else None
    role = getattr(user, "role", None)
    if db is None or role is None:
        return []
    rows = db.execute(
        select(Permission.resource, Permission.action)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(RolePermission.role_id == role.id)
        .order_by(Permission.resource.asc(), Permission.action.asc())
    ).all()
    return [f"{resource}.{action}" for resource, action in rows]


def enforce(decision: AuthorizationDecision, *, hide_case: bool = False) -> None:
    if decision.allowed:
        return
    logger.info("authorization denied reason=%s", decision.reason)
    if decision.reason in {DecisionReason.NOT_AUTHENTICATED.value, DecisionReason.USER_INACTIVE.value}:
        raise AppError(401, "authentication_failed", SAFE_UNAUTHENTICATED)
    if hide_case and decision.reason in {
        DecisionReason.CASE_ACCESS_DENIED.value,
        DecisionReason.DEPARTMENT_RESTRICTION.value,
        DecisionReason.RESOURCE_ACCESS_DENIED.value,
        DecisionReason.INVALID_RESOURCE.value,
    }:
        raise AppError(404, "not_found", SAFE_CASE_HIDDEN)
    raise AppError(403, "forbidden", SAFE_FORBIDDEN)


def can_access(user, resource, action, case=None) -> bool:
    """Boolean adapter for older call sites. New code should use authorize()."""
    resource_type = _legacy_resource(resource)
    action_value = _legacy_action(action)
    if resource_type is None or action_value is None:
        return False
    return authorize(user, action_value, resource_type, case=case).allowed


def assert_can_access(user, resource, action, case=None) -> None:
    resource_type = _legacy_resource(resource)
    action_value = _legacy_action(action)
    if resource_type is None or action_value is None:
        enforce(_deny(DecisionReason.MISSING_PERMISSION))
        return
    enforce(authorize(user, action_value, resource_type, case=case))


def _role_has_permission(user, resource_type: ResourceType, action: Action) -> bool:
    db = object_session(user)
    role = getattr(user, "role", None)
    if db is None or role is None:
        return False
    code = permission_code(resource_type, action)
    row = db.scalar(
        select(Permission.id)
        .join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(
            RolePermission.role_id == role.id,
            Permission.resource == resource_type.value,
            Permission.action == action.value,
        )
    )
    if row is None:
        logger.info("missing permission code=%s role=%s", code, getattr(role, "name", None))
        return False
    return True


def _has_active_grant(db: Session, user_id, case_id) -> bool:
    now = datetime.now(timezone.utc)
    grant = db.scalar(
        select(AccessRequest.id).where(
            AccessRequest.case_id == case_id,
            AccessRequest.requester_id == user_id,
            AccessRequest.status == RequestStatus.APPROVED.value,
            or_(AccessRequest.expires_at.is_(None), AccessRequest.expires_at > now),
        )
    )
    return grant is not None


def _document_policy(user, action: Action, document, role_name: str) -> AuthorizationDecision | None:
    """Classification and sealed-state rules. Role permission and case access are already checked."""
    status = getattr(document, "status", None)
    if status in IMMUTABLE_DOCUMENT_STATUSES and action in {Action.UPDATE, Action.UPLOAD, Action.DELETE}:
        return _deny(DecisionReason.ACTION_NOT_ALLOWED)
    if action == Action.DELETE and status != DocumentStatus.DRAFT.value:
        return _deny(DecisionReason.ACTION_NOT_ALLOWED)

    classification = getattr(document, "classification", None)
    gated = {Action.READ, Action.DOWNLOAD, Action.UPDATE, Action.UPLOAD, Action.EXPORT, Action.CREATE}
    if classification in ELEVATED_DOCUMENT_CLASSIFICATIONS and action in gated:
        if role_has_system_case_access(role_name) or role_name == RoleName.POLICE_SUPERVISOR.value:
            return None
        if _has_document_grant(user, document, action):
            return None
        return _deny(DecisionReason.RESOURCE_ACCESS_DENIED)
    return None


def _has_document_grant(user, document, action: Action) -> bool:
    db = object_session(user)
    document_id = getattr(document, "id", None)
    case_id = getattr(document, "case_id", None)
    if db is None or document_id is None or case_id is None:
        return False
    now = datetime.now(timezone.utc)
    accepted = {action.value, Action.READ.value} if action == Action.DOWNLOAD else {action.value}
    grant = db.scalar(
        select(AccessRequest.id).where(
            AccessRequest.case_id == case_id,
            AccessRequest.requester_id == user.id,
            AccessRequest.resource_type == ResourceType.DOCUMENT.value,
            AccessRequest.resource_id == document_id,
            AccessRequest.requested_action.in_(accepted),
            AccessRequest.status == RequestStatus.APPROVED.value,
            or_(AccessRequest.expires_at.is_(None), AccessRequest.expires_at > now),
        )
    )
    return grant is not None


def _custody_policy(user, action: Action, resource, role_name: str, resource_type: ResourceType) -> AuthorizationDecision | None:
    """Original evidence and derived artifacts stay immutable after they are stored."""
    if action in {Action.UPDATE, Action.DELETE}:
        return _deny(DecisionReason.ACTION_NOT_ALLOWED)
    if action == Action.UPLOAD and getattr(resource, "id", None) is not None:
        return _deny(DecisionReason.ACTION_NOT_ALLOWED)

    classification = getattr(resource, "classification", None)
    gated = {Action.READ, Action.DOWNLOAD, Action.UPLOAD, Action.EXPORT, Action.CREATE, Action.VERIFY, Action.APPROVE}
    if classification in ELEVATED_DOCUMENT_CLASSIFICATIONS and action in gated:
        if role_has_system_case_access(role_name) or role_name == RoleName.POLICE_SUPERVISOR.value:
            return None
        if _has_resource_grant(user, resource, action, resource_type):
            return None
        if action in {Action.READ, Action.DOWNLOAD, Action.VERIFY} and user_has_forensic_evidence_access(user, resource, action):
            return None
        return _deny(DecisionReason.RESOURCE_ACCESS_DENIED)
    return None


def user_has_forensic_evidence_access(user, evidence, action: Action) -> bool:
    """Request-scoped read access. An examiner role alone does not open every evidence item."""
    if action not in {Action.READ, Action.DOWNLOAD, Action.VERIFY}:
        return False
    evidence_id = getattr(evidence, "id", None)
    if user is None or evidence_id is None:
        return False
    db = object_session(user) or object_session(evidence)
    if db is None:
        return False
    role_name = getattr(getattr(user, "role", None), "name", None)
    from app.models.forensic import ForensicRequest, ForensicRequestEvidence

    requests = db.scalars(
        select(ForensicRequest)
        .join(ForensicRequestEvidence, ForensicRequestEvidence.request_id == ForensicRequest.id)
        .where(ForensicRequestEvidence.evidence_id == evidence_id)
    ).all()
    for request in requests:
        examiner = (
            role_name == RoleName.FORENSIC_EXAMINER.value
            and request.assigned_to == user.id
            and request.status in EXAMINATION_STATUSES
        )
        reviewer = (
            role_name == RoleName.FORENSIC_REVIEWER.value
            and action == Action.READ
            and request.status in REVIEW_VISIBLE_STATUSES
        )
        if examiner or reviewer:
            return True
    return False


def _has_resource_grant(user, resource, action: Action, resource_type: ResourceType) -> bool:
    db = object_session(user)
    resource_id = getattr(resource, "id", None)
    case_id = getattr(resource, "case_id", None)
    if db is None or resource_id is None or case_id is None:
        return False
    now = datetime.now(timezone.utc)
    accepted = {action.value, Action.READ.value} if action == Action.DOWNLOAD else {action.value}
    grant = db.scalar(
        select(AccessRequest.id).where(
            AccessRequest.case_id == case_id,
            AccessRequest.requester_id == user.id,
            AccessRequest.resource_type == resource_type.value,
            AccessRequest.resource_id == resource_id,
            AccessRequest.requested_action.in_(accepted),
            AccessRequest.status == RequestStatus.APPROVED.value,
            or_(AccessRequest.expires_at.is_(None), AccessRequest.expires_at > now),
        )
    )
    return grant is not None


def _department_blocks(user, case, role_name: str) -> bool:
    if role_has_system_case_access(role_name):
        return False
    case_department = getattr(case, "department_id", None)
    user_department = getattr(user, "department_id", None)
    return case_department is not None and user_department is not None and case_department != user_department


def _deny(reason: DecisionReason) -> AuthorizationDecision:
    return AuthorizationDecision(False, reason.value)


def _as_action(value) -> Action | None:
    if isinstance(value, Action):
        return value
    try:
        return Action(str(value).upper())
    except ValueError:
        return None


def _as_resource(value) -> ResourceType | None:
    if isinstance(value, ResourceType):
        return value
    try:
        return ResourceType(str(value).upper())
    except ValueError:
        return None


def _legacy_resource(resource) -> ResourceType | None:
    mapping = {
        "case": ResourceType.CASE,
        "user": ResourceType.USER,
        "read_self": ResourceType.USER,
    }
    if isinstance(resource, ResourceType):
        return resource
    return mapping.get(str(resource))


def _legacy_action(action) -> Action | None:
    mapping = {
        "list": Action.READ,
        "read": Action.READ,
        "read_self": Action.READ,
        "create": Action.CREATE,
    }
    if isinstance(action, Action):
        return action
    return mapping.get(str(action)) or _as_action(action)
