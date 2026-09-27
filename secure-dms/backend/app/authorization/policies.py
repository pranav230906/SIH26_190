"""Attribute and conflict-of-interest rules shared by every authorization decision."""

from app.constants import Action, AssignmentType, ResourceType, RoleName

CASE_SCOPED_RESOURCES = {
    ResourceType.CASE,
    ResourceType.DOCUMENT,
    ResourceType.EVIDENCE,
    ResourceType.FORENSIC_REPORT,
    ResourceType.DERIVED_ARTIFACT,
    ResourceType.REVISION,
    ResourceType.ACCESS_REQUEST,
    ResourceType.COURT_PACKAGE,
}

MUTATING_ACTIONS = {
    Action.CREATE,
    Action.UPDATE,
    Action.DELETE,
    Action.UPLOAD,
    Action.SIGN,
    Action.ASSIGN,
}

REVIEW_ACTIONS = {Action.APPROVE, Action.REJECT}

JUDICIAL_ACTIONS = {Action.READ, Action.VERIFY}
JUDICIAL_RECORD_ACTIONS = {Action.CREATE, Action.UPLOAD}
EMERGENCY_GRANT_HOURS = 24

REQUESTABLE_ACTIONS = {
    Action.READ,
    Action.DOWNLOAD,
    Action.UPLOAD,
    Action.EXPORT,
    Action.VERIFY,
}

ASSIGNMENT_ROLE = {
    AssignmentType.PRIMARY_OFFICER: RoleName.POLICE_OFFICER.value,
    AssignmentType.SUPERVISOR: RoleName.POLICE_SUPERVISOR.value,
    AssignmentType.FORENSIC_EXAMINER: RoleName.FORENSIC_EXAMINER.value,
    AssignmentType.FORENSIC_REVIEWER: RoleName.FORENSIC_REVIEWER.value,
    AssignmentType.PROSECUTOR: RoleName.PROSECUTOR.value,
    AssignmentType.JUDICIAL_ACCESS: RoleName.JUDICIAL_USER.value,
}

GRANT_DAYS = 7

ELEVATED_DOCUMENT_CLASSIFICATIONS = frozenset({"HIGHLY_CONFIDENTIAL", "RESTRICTED"})
FORENSIC_REQUEST_TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"SUBMITTED", "CANCELLED"}),
    "SUBMITTED": frozenset({"PENDING_APPROVAL", "CANCELLED"}),
    "PENDING_APPROVAL": frozenset({"APPROVED", "REJECTED", "CANCELLED"}),
    "APPROVED": frozenset({"ASSIGNED"}),
    "ASSIGNED": frozenset({"IN_PROGRESS"}),
    "IN_PROGRESS": frozenset({"SUBMITTED_FOR_REVIEW"}),
    "SUBMITTED_FOR_REVIEW": frozenset({"COMPLETED", "IN_PROGRESS"}),
    "COMPLETED": frozenset(),
    "REJECTED": frozenset(),
    "CANCELLED": frozenset(),
}

EXAMINATION_STATUSES = frozenset({"APPROVED", "ASSIGNED", "IN_PROGRESS"})
REVIEW_VISIBLE_STATUSES = frozenset({"SUBMITTED_FOR_REVIEW", "COMPLETED"})

DOCUMENT_VERSION_TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"SUBMITTED_FOR_REVIEW"}),
    "SUBMITTED_FOR_REVIEW": frozenset({"APPROVED", "REJECTED"}),
    "APPROVED": frozenset({"SUPERSEDED"}),
    "REJECTED": frozenset(),
    "SUPERSEDED": frozenset(),
}

EVIDENCE_STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    "RECEIVED": frozenset({"VERIFIED"}),
    "VERIFIED": frozenset({"SEALED"}),
    "SEALED": frozenset({"ARCHIVED"}),
    "ARCHIVED": frozenset(),
}
IMMUTABLE_DOCUMENT_STATUSES = frozenset({"SEALED", "ARCHIVED"})
DOCUMENT_STATUS_TRANSITIONS: dict[str, frozenset[str]] = {
    "DRAFT": frozenset({"UNDER_REVIEW"}),
    "UNDER_REVIEW": frozenset({"APPROVED", "DRAFT"}),
    "APPROVED": frozenset({"SEALED"}),
    "SEALED": frozenset({"ARCHIVED"}),
    "ARCHIVED": frozenset(),
}


def role_has_system_case_access(role_name: str | None) -> bool:
    """Administrators hold system-wide case access only after their permission row is granted."""
    return role_name == RoleName.ADMIN.value


def requires_case_context(resource_type: ResourceType, action: Action, case) -> bool:
    if resource_type not in CASE_SCOPED_RESOURCES:
        return False
    if resource_type == ResourceType.CASE and action == Action.CREATE:
        return False
    if resource_type == ResourceType.CASE and action == Action.READ and case is None:
        return False
    if resource_type == ResourceType.CASE and action == Action.ASSIGN and case is None:
        return False
    if resource_type == ResourceType.ACCESS_REQUEST and case is None and action in {
        Action.CREATE,
        Action.READ,
        Action.APPROVE,
        Action.REJECT,
    }:
        return False
    if resource_type == ResourceType.FORENSIC_REPORT and case is None and action in {Action.READ, Action.REVIEW}:
        return False
    if resource_type == ResourceType.COURT_PACKAGE and case is None and action == Action.READ:
        return False
    return True


def is_self_review(user, resource) -> bool:
    """True when the actor would approve or reject their own request, revision, or submission."""
    if user is None or resource is None:
        return False
    actor_id = getattr(user, "id", None)
    for attribute in ("requester_id", "requested_by", "created_by", "submitted_by"):
        subject_id = getattr(resource, attribute, None)
        if subject_id is not None and subject_id == actor_id:
            return True
    return False


def document_transition_action(current: str, target: str) -> Action | None:
    """Action required to move a document. Approval and sealing cannot be self-reviewed."""
    allowed = DOCUMENT_STATUS_TRANSITIONS.get(current, frozenset())
    if target not in allowed:
        return None
    if current == "DRAFT" and target == "UNDER_REVIEW":
        return Action.UPDATE
    if current == "UNDER_REVIEW" and target == "DRAFT":
        return Action.REVIEW
    return Action.APPROVE


def assignment_matches_role(assignment_type: AssignmentType, role_name: str | None) -> bool:
    expected = ASSIGNMENT_ROLE.get(assignment_type)
    return expected is not None and expected == role_name
