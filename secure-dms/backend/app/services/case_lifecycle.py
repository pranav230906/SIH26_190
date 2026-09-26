"""Allowed case status changes. Later workflow rules can extend this map."""

from app.constants import CaseStatus
from app.core.exceptions import AppError

STATUS_LABELS: dict[CaseStatus, str] = {
    CaseStatus.DRAFT: "Draft",
    CaseStatus.ACTIVE: "Active",
    CaseStatus.UNDER_INVESTIGATION: "Under investigation",
    CaseStatus.UNDER_REVIEW: "Under review",
    CaseStatus.READY_FOR_PROSECUTION: "Ready for prosecution",
    CaseStatus.IN_COURT: "In court",
    CaseStatus.CLOSED: "Closed",
    CaseStatus.ARCHIVED: "Archived",
}

_SEQUENCE: tuple[CaseStatus, ...] = (
    CaseStatus.DRAFT,
    CaseStatus.ACTIVE,
    CaseStatus.UNDER_INVESTIGATION,
    CaseStatus.UNDER_REVIEW,
    CaseStatus.READY_FOR_PROSECUTION,
    CaseStatus.IN_COURT,
    CaseStatus.CLOSED,
    CaseStatus.ARCHIVED,
)

ALLOWED_TRANSITIONS: dict[CaseStatus, frozenset[CaseStatus]] = {
    status: frozenset({_SEQUENCE[index + 1]}) if index + 1 < len(_SEQUENCE) else frozenset()
    for index, status in enumerate(_SEQUENCE)
}

INITIAL_STATUSES: frozenset[CaseStatus] = frozenset({CaseStatus.DRAFT, CaseStatus.ACTIVE})


def status_label(value: str) -> str:
    try:
        return STATUS_LABELS[CaseStatus(value)]
    except ValueError:
        return value


def allowed_status_values(current: str) -> list[str]:
    try:
        status = CaseStatus(current)
    except ValueError:
        return []
    return [item.value for item in _SEQUENCE if item in ALLOWED_TRANSITIONS[status]]


def assert_initial_status(status: CaseStatus) -> None:
    if status not in INITIAL_STATUSES:
        raise AppError(422, "validation_error", "A new case can start as Draft or Active.")


def assert_status_transition(current: str, target: CaseStatus) -> None:
    if target.value == current:
        raise AppError(422, "validation_error", "That status is already set.")
    try:
        status = CaseStatus(current)
    except ValueError:
        raise AppError(422, "validation_error", "That status change is not allowed.") from None
    if target not in ALLOWED_TRANSITIONS[status]:
        raise AppError(422, "validation_error", "That status change is not allowed.")
